package com.familyarcade.platform;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.annotation.TargetApi;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONException;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends BaseActivity {
    public static final String HOST = "arcade.local";
    public static final String BASE = "https://" + HOST + "/";
    public static final String REMOTE_HOST = "to-shreds.github.io";
    public static final String REMOTE_BASE = "https://" + REMOTE_HOST + "/arcade/";
    private static final int PICK_TREE = 40;
    private static final int PICK_WEB_FILE = 41;
    private static final int RECORD_AUDIO_REQUEST = 42;
    private FrameLayout root;
    private volatile WebView webView;
    private volatile LocalClient activeClient;
    private ProgressBar progress;
    private volatile ArcadeStorage storage;
    private PermissionRequest pendingAudioPermission;
    private ValueCallback<Uri[]> pendingFileChooser;
    private boolean pinRequested;
    private boolean loaded;
    private final Object catalogLock = new Object();
    private volatile CatalogScanner cachedCatalog;
    private volatile ArcadeStorage cachedCatalogStorage;
    private volatile boolean destroyed;
    private long rendererCrashWindow;
    private int rendererCrashCount;
    private volatile TextToSpeech textToSpeech;
    private volatile boolean ttsReady;
    private volatile boolean remoteMode = true;
    private volatile boolean forceOffline;
    private volatile boolean archiveSyncInProgress;
    private final AtomicBoolean remoteRecoveryScheduled = new AtomicBoolean();
    private final ExecutorService archiveExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private OfflineArchiveManager offlineArchive;
    private int startupGeneration;
    private int webGeneration;
    private int watchdogTicket;
    private Runnable startupWatchdog;
    private boolean webReady;
    private String pendingSpeech;
    private float pendingSpeechRate = 1f;
    private float pendingSpeechPitch = 1f;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        setContentView(root);
        initializeSpeech();
        storage = ArcadeStorage.fromPreferences(this);
        try {
            offlineArchive = new OfflineArchiveManager(getApplicationContext());
        } catch (RuntimeException error) {
            Log.e("Arcade", "Offline archive could not initialize", error);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) ServiceWorkerApi24.install(this);
        if (getIntent().getBooleanExtra("changeFolder", false)) {
            chooseFolder();
        } else {
            startOnlineArcade(getIntent());
        }
    }

    private void startOnlineArcade(Intent intent) {
        remoteMode = true;
        forceOffline = false;
        final int generation = ++startupGeneration;
        final Intent requestedIntent = new Intent(intent);
        showStartingScreen();
        OfflineArchiveManager manager = offlineArchive;
        if (manager == null) {
            beginRemoteWeb(generation, requestedIntent, false);
            return;
        }
        try {
            archiveExecutor.execute(() -> {
                boolean hasArchive = manager.validateReadyArchive();
                OfflineArchiveManager.ArchiveManifest remoteManifest = null;
                try {
                    remoteManifest = manager.fetchRemoteManifest();
                } catch (IOException | RuntimeException error) {
                    Log.w("Arcade", "Remote Arcade manifest is unavailable", error);
                }
                OfflineArchiveManager.ArchiveManifest validatedManifest = remoteManifest;
                if (validatedManifest != null) {
                    archiveSyncInProgress = true;
                    mainHandler.post(() -> beginRemoteWeb(generation, requestedIntent, false));
                    try {
                        manager.synchronize(validatedManifest);
                    } catch (IOException | RuntimeException error) {
                        Log.w("Arcade", "Offline Arcade update was not activated", error);
                    } finally {
                        archiveSyncInProgress = false;
                    }
                } else {
                    boolean fallbackReady = hasArchive && manager.isReady();
                    mainHandler.post(() -> {
                        if (!remoteGenerationCurrent(generation)) return;
                        if (fallbackReady) beginRemoteWeb(generation, requestedIntent, true);
                        else showRemoteRecoveryScreen("The hosted Arcade could not be reached and no validated offline copy is ready yet.");
                    });
                }
            });
        } catch (RejectedExecutionException error) {
            if (!destroyed) showRemoteRecoveryScreen("The Arcade startup service is unavailable.");
        }
    }

    private void showStartingScreen() {
        destroyWebView();
        root.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(Ui.dp(this, 28), Ui.dp(this, 24), Ui.dp(this, 28), Ui.dp(this, 24));
        panel.setBackgroundColor(Ui.BG);
        TextView title = Ui.text(this, "Arcade", 38, Ui.GOLD, true);
        title.setGravity(Gravity.CENTER);
        TextView copy = Ui.text(this, "Opening your games…", 17, Ui.MUTED, false);
        copy.setGravity(Gravity.CENTER);
        copy.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 18));
        panel.addView(title);
        panel.addView(copy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(new ProgressBar(this), new LinearLayout.LayoutParams(Ui.dp(this, 46), Ui.dp(this, 46)));
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void beginRemoteWeb(int generation, Intent intent, boolean offline) {
        if (!remoteGenerationCurrent(generation)) return;
        forceOffline = offline;
        destroyWebView();
        if (!showWebView()) {
            showRemoteRecoveryScreen("The Arcade viewer could not start.");
            return;
        }
        openIntentPath(intent);
    }

    private boolean remoteGenerationCurrent(int generation) {
        return !destroyed && !isFinishing() && remoteMode && generation == startupGeneration;
    }

    private void initializeSpeech() {
        textToSpeech = new TextToSpeech(getApplicationContext(), status -> runOnUiThread(() -> {
            TextToSpeech engine = textToSpeech;
            if (destroyed || engine == null || status != TextToSpeech.SUCCESS) return;
            int language = engine.setLanguage(Locale.US);
            ttsReady = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED;
            if (ttsReady && pendingSpeech != null) {
                String text = pendingSpeech;
                pendingSpeech = null;
                speakWithNativeEngine(text, pendingSpeechRate, pendingSpeechPitch);
            }
        }));
    }

    private static float speechValue(double value) {
        if (!Double.isFinite(value)) return 1f;
        return (float) Math.max(0.5d, Math.min(2d, value));
    }

    private void speakWithNativeEngine(String text, float rate, float pitch) {
        TextToSpeech engine = textToSpeech;
        if (!ttsReady || engine == null || text == null || text.isEmpty()) return;
        engine.setSpeechRate(rate);
        engine.setPitch(pitch);
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "arcade-" + SystemClock.uptimeMillis());
    }

    private void startRememberedFolder(Intent intent) {
        remoteMode = false;
        forceOffline = false;
        startupGeneration++;
        if (storage == null) {
            ArcadeStorage.clearRememberedTree(this);
            showFolderScreen(null);
            return;
        }
        try {
            storage.invalidateCache();
            if (!storage.hasPersistedAccess()) {
                forgetFolder("Arcade folder access was lost.");
                return;
            }
            if (!storage.available()) {
                showViewerRecoveryScreen("Android could not read the Arcade folder yet.");
                return;
            }
            ArcadeStorage.Doc index = storage.childRequired(storage.getRootUri(), "index.html");
            if (index == null || index.isDirectory()) {
                showViewerRecoveryScreen("The selected folder does not contain index.html yet.");
                return;
            }
            if (!showWebView()) {
                showViewerRecoveryScreen("The Arcade viewer could not start.");
                return;
            }
            openIntentPath(intent);
        } catch (ArcadeStorage.StorageQueryException error) {
            Log.e("Arcade", "Saved folder could not be read", error);
            showViewerRecoveryScreen("Android could not read the Arcade folder yet.");
        } catch (Exception error) {
            Log.e("Arcade", "Saved folder startup failed", error);
            forgetFolder("Arcade folder access was lost.");
        }
    }

    private void forgetFolder(String warning) {
        ArcadeStorage.clearRememberedTree(this);
        storage = null;
        invalidateCatalog(false);
        showFolderScreen(warning);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("changeFolder", false)) chooseFolder();
        else if (intent.getBooleanExtra("useLocalFolder", false)) startRememberedFolder(intent);
        else if (webView == null) startOnlineArcade(intent);
        else openIntentPath(intent);
    }

    private void openIntentPath(Intent intent) {
        String path = intent.getStringExtra("openPath");
        if (path == null || path.isEmpty()) loadHome();
        else openGame(path);
    }

    private void showFolderScreen(String warning) {
        destroyWebView();
        root.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(Ui.dp(this, 28), Ui.dp(this, 24), Ui.dp(this, 28), Ui.dp(this, 24));
        panel.setBackgroundColor(Ui.BG);
        TextView title = Ui.text(this, "Arcade", 38, Ui.GOLD, true);
        title.setGravity(Gravity.CENTER);
        TextView copy = Ui.text(this, warning == null ? "Select the extracted Arcade folder." : warning + "\nSelect the Arcade folder again.", 17, Ui.MUTED, false);
        copy.setGravity(Gravity.CENTER);
        copy.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 22));
        Button choose = Ui.button(this, "Choose Arcade Folder");
        choose.setTextSize(17);
        choose.setOnClickListener(v -> chooseFolder());
        Button online = Ui.button(this, "Use Online Arcade");
        online.setTextSize(17);
        online.setOnClickListener(v -> startOnlineArcade(getIntent()));
        panel.addView(title);
        panel.addView(copy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(choose, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 54)));
        LinearLayout.LayoutParams onlineParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 54));
        onlineParams.topMargin = Ui.dp(this, 10);
        panel.addView(online, onlineParams);
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showViewerRecoveryScreen(String warning) {
        destroyWebView();
        root.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(Ui.dp(this, 28), Ui.dp(this, 24), Ui.dp(this, 28), Ui.dp(this, 24));
        panel.setBackgroundColor(Ui.BG);
        TextView title = Ui.text(this, "Arcade", 38, Ui.GOLD, true);
        title.setGravity(Gravity.CENTER);
        TextView copy = Ui.text(this, warning + "\nNo uninstall is needed. Try the viewer again or select the Arcade folder again.", 17, Ui.MUTED, false);
        copy.setGravity(Gravity.CENTER);
        copy.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 22));
        LinearLayout actions = Ui.row(this);
        actions.setGravity(Gravity.CENTER);
        Button retry = Ui.button(this, "Try Again");
        retry.setOnClickListener(v -> retryViewer());
        Button choose = Ui.button(this, "Choose Arcade Folder");
        choose.setOnClickListener(v -> chooseFolder());
        actions.addView(retry);
        actions.addView(Ui.text(this, " ", 8, Color.TRANSPARENT, false));
        actions.addView(choose);
        panel.addView(title);
        panel.addView(copy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 58)));
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showRemoteRecoveryScreen(String warning) {
        destroyWebView();
        root.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(Ui.dp(this, 28), Ui.dp(this, 24), Ui.dp(this, 28), Ui.dp(this, 24));
        panel.setBackgroundColor(Ui.BG);
        TextView title = Ui.text(this, "Arcade", 38, Ui.GOLD, true);
        title.setGravity(Gravity.CENTER);
        TextView copy = Ui.text(this, warning + "\nTry again when connected, or use a selected local Arcade folder. A failed download never replaces the last validated offline copy.", 17, Ui.MUTED, false);
        copy.setGravity(Gravity.CENTER);
        copy.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 22));
        LinearLayout actions = Ui.row(this);
        actions.setGravity(Gravity.CENTER);
        Button retry = Ui.button(this, "Try Online Again");
        retry.setOnClickListener(v -> startOnlineArcade(getIntent()));
        Button local = Ui.button(this, "Use Local Folder");
        local.setOnClickListener(v -> useLocalFolder());
        actions.addView(retry);
        actions.addView(Ui.text(this, " ", 8, Color.TRANSPARENT, false));
        actions.addView(local);
        panel.addView(title);
        panel.addView(copy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 58)));
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void useLocalFolder() {
        ArcadeStorage active = storage;
        if (active == null || !active.hasPersistedAccess() || !active.available()) {
            chooseFolder();
            return;
        }
        destroyWebView();
        startRememberedFolder(getIntent());
    }

    private void retryViewer() {
        ArcadeStorage active = storage;
        if (active == null || !active.hasPersistedAccess()) {
            forgetFolder("Arcade folder access was lost.");
            return;
        }
        if (!active.available()) {
            showViewerRecoveryScreen("Android still could not read the Arcade folder.");
            return;
        }
        active.invalidateCache();
        invalidateCatalog(false);
        rendererCrashWindow = 0;
        rendererCrashCount = 0;
        if (!showWebView()) {
            showViewerRecoveryScreen("The Arcade viewer still could not start.");
            return;
        }
        ArcadeStorage.rememberTree(this, active.getTreeUri());
        loadHome();
    }

    public void chooseFolder() {
        if (isPinned()) {
            new AlertDialog.Builder(this)
                .setTitle("Unpin Arcade first")
                .setMessage("Use your normal Android unpin gesture, then choose Change Folder again.")
                .setPositiveButton("OK", null)
                .show();
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try {
            startActivityForResult(intent, PICK_TREE);
        } catch (RuntimeException error) {
            Log.e("Arcade", "Folder picker could not open", error);
            message("Android could not open the folder picker.");
            if (!loaded) showFolderScreen("Android could not open the folder picker.");
        }
    }

    private boolean isPinned() {
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        return manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_TREE) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                if (!loaded) showFolderScreen(null);
                return;
            }
            Uri uri = data.getData();
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            ArcadeStorage candidate;
            try {
                getContentResolver().takePersistableUriPermission(uri, flags);
                candidate = new ArcadeStorage(this, uri);
                candidate.invalidateCache();
                if (!candidate.available()) {
                    folderSelectionFailed("Android could not retain access to that folder.");
                    return;
                }
                ArcadeStorage.Doc index = candidate.childRequired(candidate.getRootUri(), "index.html");
                if (index == null || index.isDirectory()) {
                    folderSelectionFailed("That folder does not contain index.html.");
                    return;
                }
            } catch (Exception error) {
                Log.e("Arcade", "Folder selection failed", error);
                folderSelectionFailed("Android could not retain access to that folder.");
                return;
            }
            destroyWebView();
            storage = candidate;
            remoteMode = false;
            forceOffline = false;
            startupGeneration++;
            invalidateCatalog(false);
            if (!showWebView()) {
                showViewerRecoveryScreen("The folder is valid, but the Arcade viewer could not start.");
                return;
            }
            ArcadeStorage.rememberTree(this, uri);
            try {
                loadHome();
            } catch (RuntimeException error) {
                Log.e("Arcade", "Initial page load failed", error);
                showViewerRecoveryScreen("The Arcade viewer could not load the selected folder.");
            }
        } else if (requestCode == PICK_WEB_FILE) {
            if (pendingFileChooser == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    result = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            pendingFileChooser.onReceiveValue(result);
            pendingFileChooser = null;
        }
    }

    private void folderSelectionFailed(String warning) {
        if (webView != null && loaded) message(warning);
        else showFolderScreen(warning);
    }

    private boolean showWebView() {
        if (webView != null && webView.getParent() != null) return true;
        destroyWebView();
        root.removeAllViews();
        WebView created = null;
        try {
            created = new WebView(this);
            created.setBackgroundColor(Ui.BG);
            created.setFocusable(true);
            created.setFocusableInTouchMode(true);
            WebSettings settings = created.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            settings.setUserAgentString(settings.getUserAgentString() + " ArcadePlatform/2.3.0");
            WebView.setWebContentsDebuggingEnabled(false);
            int boundGeneration = remoteMode ? startupGeneration : 0;
            boolean boundOffline = remoteMode && forceOffline;
            created.addJavascriptInterface(new ArcadeBridge(boundGeneration), "ArcadeNative");
            WebView boundView = created;
            ArcadeStorage boundStorage = storage;
            boolean boundRemote = remoteMode;
            LocalClient client = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new LocalClientApi26(boundView, boundStorage, boundRemote, boundOffline, boundGeneration)
                : new LocalClient(boundView, boundStorage, boundRemote, boundOffline, boundGeneration);
            created.setWebViewClient(client);
            created.setWebChromeClient(new ArcadeChrome());
            ProgressBar spinner = new ProgressBar(this);
            root.addView(created, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(Ui.dp(this, 46), Ui.dp(this, 46), Gravity.CENTER);
            root.addView(spinner, progressParams);
            webView = created;
            activeClient = client;
            progress = spinner;
            webGeneration = boundGeneration;
            webReady = false;
            loaded = true;
            return true;
        } catch (RuntimeException | LinkageError error) {
            Log.e("Arcade", "WebView creation failed", error);
            if (created != null) {
                try { root.removeView(created); } catch (Exception ignored) {}
                try { created.destroy(); } catch (Exception ignored) {}
            }
            webView = null;
            progress = null;
            loaded = false;
            return false;
        }
    }

    private void destroyWebView() {
        LocalClient oldClient = activeClient;
        activeClient = null;
        if (oldClient != null) oldClient.cancelRecovery();
        WebView old = webView;
        ProgressBar oldProgress = progress;
        webView = null;
        progress = null;
        webGeneration = 0;
        webReady = false;
        loaded = false;
        if (pendingFileChooser != null) {
            try { pendingFileChooser.onReceiveValue(null); } catch (Exception ignored) {}
            pendingFileChooser = null;
        }
        if (pendingAudioPermission != null) {
            try { pendingAudioPermission.deny(); } catch (Exception ignored) {}
            pendingAudioPermission = null;
        }
        if (oldProgress != null) {
            try { root.removeView(oldProgress); } catch (Exception ignored) {}
        }
        if (old != null) {
            try { old.stopLoading(); } catch (Exception ignored) {}
            try { old.removeJavascriptInterface("ArcadeNative"); } catch (Exception ignored) {}
            try { root.removeView(old); } catch (Exception ignored) {}
            try { old.destroy(); } catch (Exception ignored) {}
        }
    }

    private void loadHome() {
        if (webView == null) return;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (progress != null) progress.setVisibility(View.VISIBLE);
        if (remoteMode) {
            webReady = false;
            scheduleStartupWatchdog(webGeneration);
            webView.loadUrl(REMOTE_BASE);
        }
        else webView.loadUrl(BASE + "index.html?t=" + System.currentTimeMillis());
    }

    private void scheduleStartupWatchdog(int generation) {
        if (generation <= 0) return;
        final int ticket = ++watchdogTicket;
        Runnable watchdog = () -> {
            if (destroyed || ticket != watchdogTicket || generation != webGeneration || generation != startupGeneration || webReady || !remoteMode) return;
            Log.w("Arcade", "Arcade startup readiness timed out");
            fallbackAfterRemoteFailure(activeClient, webView);
        };
        startupWatchdog = watchdog;
        mainHandler.postDelayed(watchdog, 10000L);
    }

    private void markArcadeReady(int generation) {
        if (generation <= 0 || generation != webGeneration || generation != startupGeneration || !remoteMode) return;
        webReady = true;
        watchdogTicket++;
        Runnable watchdog = startupWatchdog;
        startupWatchdog = null;
        if (watchdog != null) mainHandler.removeCallbacks(watchdog);
        if (progress != null) progress.setVisibility(View.GONE);
        try {
            if (webView != null) webView.requestFocus(View.FOCUS_DOWN);
        } catch (RuntimeException ignored) {}
    }

    private void openGame(String path) {
        openGame(path, null);
    }

    private void openGame(String path, String orientation) {
        if (remoteMode) {
            if (webView == null) return;
            if (!safeRemotePath(path)) {
                message("That item is unavailable.");
                return;
            }
            applyOrientation(orientation);
            if (progress != null) progress.setVisibility(View.VISIBLE);
            webView.loadUrl(REMOTE_BASE + Uri.encode(path, "/"));
            return;
        }
        ArcadeStorage active = storage;
        if (webView == null || active == null) return;
        try {
            CatalogScanner.Entry entry = catalogFor(active).byLaunchPath(path);
            if (entry == null || entry.warning != null || !entry.metadata.enabled) {
                message("That item is unavailable. Check Manage Games.");
                return;
            }
            applyOrientation(entry.metadata.orientation);
            if (progress != null) progress.setVisibility(View.VISIBLE);
            webView.loadUrl(BASE + Uri.encode(entry.launchPath(), "/"));
        } catch (RuntimeException error) {
            Log.e("Arcade", "Could not open game", error);
            requestStorageRecovery(activeClient, webView, active, error, false);
            message("Arcade could not open that item. Try Reload.");
        }
    }

    private static boolean safeRemotePath(String path) {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.contains("..") || path.contains(":") || path.contains("\\")) return false;
        return path.matches("[A-Za-z0-9._/-]+") && path.endsWith(".html");
    }

    private CatalogScanner catalogFor(ArcadeStorage active) {
        CatalogScanner cached = cachedCatalog;
        if (cached != null && cachedCatalogStorage == active) return cached;
        synchronized (catalogLock) {
            cached = cachedCatalog;
            if (cached != null && cachedCatalogStorage == active) return cached;
            CatalogScanner scanner = new CatalogScanner(active);
            scanner.scan();
            cachedCatalogStorage = active;
            cachedCatalog = scanner;
            return scanner;
        }
    }

    private void invalidateCatalog(boolean invalidateStorage) {
        ArcadeStorage active = storage;
        synchronized (catalogLock) {
            if (invalidateStorage && active != null) active.invalidateCache();
            cachedCatalog = null;
            cachedCatalogStorage = null;
        }
    }

    private void applyOrientation(String orientation) {
        if ("landscape".equals(orientation)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        else if ("portrait".equals(orientation)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
        else setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    private boolean atHome() {
        if (webView == null || webView.getUrl() == null) return true;
        Uri uri = Uri.parse(webView.getUrl());
        String path = uri.getPath();
        if (path == null) return true;
        if (remoteMode) return path.equals("/arcade/") || path.equals("/arcade/index.html");
        return path.equals("/") || path.equals("/index.html");
    }

    @Override
    public void onBackPressed() {
        if (!atHome()) loadHome();
    }

    @Override
    protected void onPostResume() {
        super.onPostResume();
        if (loaded && !pinRequested) {
            pinRequested = true;
            getWindow().getDecorView().postDelayed(() -> {
                try {
                    if (!isPinned()) startLockTask();
                } catch (Exception ignored) {}
            }, 450);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean dirty = ArcadeStorage.takeDirty(this);
        invalidateCatalog(true);
        if (webView != null) {
            try { webView.onResume(); } catch (RuntimeException error) { Log.e("Arcade", "WebView resume failed", error); }
            if (dirty) loadHome();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            try { webView.evaluateJavascript("window.dispatchEvent(new Event('arcadepause'))", null); } catch (RuntimeException ignored) {}
            try { webView.onPause(); } catch (RuntimeException ignored) {}
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        watchdogTicket++;
        mainHandler.removeCallbacksAndMessages(null);
        archiveExecutor.shutdownNow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) ServiceWorkerApi24.clear(this);
        TextToSpeech engine = textToSpeech;
        textToSpeech = null;
        ttsReady = false;
        if (engine != null) {
            try { engine.stop(); } catch (RuntimeException ignored) {}
            try { engine.shutdown(); } catch (RuntimeException ignored) {}
        }
        destroyWebView();
        offlineArchive = null;
        storage = null;
        invalidateCatalog(false);
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != RECORD_AUDIO_REQUEST || pendingAudioPermission == null) return;
        PermissionRequest request = pendingAudioPermission;
        pendingAudioPermission = null;
        try {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else request.deny();
        } catch (RuntimeException ignored) {}
    }

    public void clearWebData() {
        if (webView != null) {
            webView.clearCache(true);
            webView.clearHistory();
        }
        WebStorage.getInstance().deleteAllData();
        message("Arcade web data cleared.");
        invalidateCatalog(true);
        if (webView != null) loadHome();
    }

    private final class ArcadeBridge {
        private final int generation;

        ArcadeBridge(int generation) {
            this.generation = generation;
        }

        @JavascriptInterface
        public void arcadeReady() {
            runOnUiThread(() -> markArcadeReady(generation));
        }

        @JavascriptInterface
        public void openGame(String path) {
            runOnUiThread(() -> MainActivity.this.openGame(path));
        }

        @JavascriptInterface
        public void openGameWithOrientation(String path, String orientation) {
            runOnUiThread(() -> MainActivity.this.openGame(path, orientation));
        }

        @JavascriptInterface
        public void openManager() {
            runOnUiThread(() -> {
                if (remoteMode) {
                    OfflineArchiveManager manager = offlineArchive;
                    String offlineStatus = manager != null && manager.isReady()
                        ? "A validated offline copy is ready" + (manager.activeVersion() == null ? "." : " (" + manager.activeVersion() + ").")
                        : "The first complete offline copy is not ready yet.";
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Online Arcade")
                        .setMessage("Games update automatically from GitHub Pages. " + offlineStatus + " Updates are downloaded and validated in the background without replacing the last working copy. The local-folder tools remain available for editing.")
                        .setPositiveButton("Refresh Online", (dialog, which) -> {
                            startOnlineArcade(getIntent());
                        })
                        .setNeutralButton("Use Local Folder", (dialog, which) -> useLocalFolder())
                        .setNegativeButton("Cancel", null)
                        .show();
                    return;
                }
                ArcadeStorage active = storage;
                if (active == null || !active.hasPersistedAccess()) {
                    forgetFolder("Arcade folder access was lost.");
                    return;
                }
                if (!active.available()) {
                    showViewerRecoveryScreen("Android could not read the Arcade folder yet.");
                    return;
                }
                startActivity(new Intent(MainActivity.this, LibraryActivity.class));
            });
        }

        @JavascriptInterface
        public void reloadArcade() {
            runOnUiThread(() -> {
                if (remoteMode) {
                    startOnlineArcade(getIntent());
                    return;
                }
                invalidateCatalog(true);
                if (webView != null) webView.clearCache(false);
                loadHome();
            });
        }

        @JavascriptInterface
        public void goHome() {
            runOnUiThread(() -> loadHome());
        }

        @JavascriptInterface
        public boolean hasSpeech() {
            return ttsReady;
        }

        @JavascriptInterface
        public void speak(String text, double rate, double pitch) {
            String clean = text == null ? "" : text.trim();
            if (clean.length() > 2000) clean = clean.substring(0, 2000);
            final String request = clean;
            final float safeRate = speechValue(rate);
            final float safePitch = speechValue(pitch);
            runOnUiThread(() -> {
                if (request.isEmpty()) return;
                if (!ttsReady) {
                    pendingSpeech = request;
                    pendingSpeechRate = safeRate;
                    pendingSpeechPitch = safePitch;
                    return;
                }
                speakWithNativeEngine(request, safeRate, safePitch);
            });
        }

        @JavascriptInterface
        public void stopSpeech() {
            runOnUiThread(() -> {
                pendingSpeech = null;
                TextToSpeech engine = textToSpeech;
                if (engine != null) try { engine.stop(); } catch (RuntimeException ignored) {}
            });
        }
    }

    private void requestStorageRecovery(LocalClient client, WebView failedView, ArcadeStorage failedStorage, Throwable error, boolean mainFrame) {
        if (destroyed || client == null || client != activeClient || failedView == null || failedView != webView || failedStorage == null || storage != failedStorage) return;
        if (mainFrame) client.mainFrameRecoveryRequested.set(true);
        Log.e("Arcade", "External folder request failed", error);
        if (!client.storageRecoveryScheduled.compareAndSet(false, true)) return;
        runOnUiThread(() -> {
            try {
                if (destroyed || isFinishing() || client != activeClient || failedView != webView || storage != failedStorage) {
                    client.mainFrameRecoveryRequested.set(false);
                    return;
                }
                boolean recoverViewer = client.mainFrameRecoveryRequested.getAndSet(false);
                invalidateCatalog(true);
                if (!failedStorage.hasPersistedAccess()) {
                    forgetFolder("The selected Arcade folder was replaced or access was lost.");
                } else if (!failedStorage.available() || recoverViewer) {
                    showViewerRecoveryScreen("Arcade content changed while the viewer was loading.");
                }
            } finally {
                client.storageRecoveryScheduled.set(false);
                if (client.mainFrameRecoveryRequested.get() && !destroyed && client == activeClient && failedView == webView && storage == failedStorage) {
                    requestStorageRecovery(client, failedView, failedStorage, error, false);
                }
            }
        });
    }

    private static boolean isRemoteArcadeUri(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || !REMOTE_HOST.equalsIgnoreCase(uri.getHost()) || uri.getPort() != -1) return false;
        String path = uri.getPath();
        return path != null && (path.equals("/arcade") || path.startsWith("/arcade/"));
    }

    private static boolean isRemoteHomeUri(Uri uri) {
        if (!isRemoteArcadeUri(uri)) return false;
        String path = uri.getPath();
        return "/arcade".equals(path) || "/arcade/".equals(path) || "/arcade/index.html".equals(path);
    }

    private void requestRemoteRecovery(LocalClient client, WebView failedView) {
        if (destroyed || client == null || client != activeClient || failedView == null || failedView != webView || !remoteMode) return;
        if (!remoteRecoveryScheduled.compareAndSet(false, true)) return;
        runOnUiThread(() -> {
            try {
                fallbackAfterRemoteFailure(client, failedView);
            } finally {
                remoteRecoveryScheduled.set(false);
            }
        });
    }

    private void fallbackAfterRemoteFailure(LocalClient client, WebView failedView) {
        if (destroyed || isFinishing() || client == null || client != activeClient || failedView == null || failedView != webView || !remoteMode) return;
        OfflineArchiveManager manager = offlineArchive;
        if (!client.boundOffline && manager != null && manager.isReady()) {
            int generation = ++startupGeneration;
            beginRemoteWeb(generation, new Intent(getIntent()), true);
            return;
        }
        if (!client.boundOffline && archiveSyncInProgress) {
            mainHandler.postDelayed(() -> requestRemoteRecovery(client, failedView), 900L);
            return;
        }
        ArcadeStorage local = storage;
        if (local != null && local.hasPersistedAccess() && local.available()) {
            destroyWebView();
            startRememberedFolder(getIntent());
            message("The app-managed offline copy was unavailable, so the selected local folder was opened.");
        } else {
            showRemoteRecoveryScreen(client.boundOffline
                ? "The validated offline Arcade could not finish loading."
                : "The hosted Arcade is unavailable and no validated offline copy is ready.");
        }
    }

    private class LocalClient extends WebViewClient {
        private final WebView boundView;
        private final ArcadeStorage boundStorage;
        private final boolean boundRemote;
        private final boolean boundOffline;
        private final int boundGeneration;
        private final AtomicBoolean storageRecoveryScheduled = new AtomicBoolean();
        private final AtomicBoolean mainFrameRecoveryRequested = new AtomicBoolean();

        LocalClient(WebView boundView, ArcadeStorage boundStorage, boolean boundRemote, boolean boundOffline, int boundGeneration) {
            this.boundView = boundView;
            this.boundStorage = boundStorage;
            this.boundRemote = boundRemote;
            this.boundOffline = boundOffline;
            this.boundGeneration = boundGeneration;
        }

        void cancelRecovery() {
            mainFrameRecoveryRequested.set(false);
            storageRecoveryScheduled.set(false);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (boundRemote) {
                if (!boundOffline) return null;
                Uri uri = request.getUrl();
                if (!isRemoteArcadeUri(uri)) return null;
                if (destroyed || view != boundView || view != webView || boundGeneration != webGeneration || !forceOffline) {
                    return errorResponse(410, "Arcade viewer replaced");
                }
                OfflineArchiveManager manager = offlineArchive;
                WebResourceResponse archived = manager == null ? null : manager.responseFor(uri);
                return archived != null ? archived : errorResponse(404, "Not in the validated offline Arcade");
            }
            ArcadeStorage active = boundStorage;
            try {
                Uri uri = request.getUrl();
                if (!"https".equalsIgnoreCase(uri.getScheme()) || !HOST.equalsIgnoreCase(uri.getHost())) return null;
                if (destroyed || view != boundView || view != webView || active == null || active != storage) {
                    return errorResponse(410, "Arcade viewer replaced");
                }
                String path = uri.getEncodedPath();
                if (path == null || path.equals("/")) path = "/index.html";
                path = Uri.decode(path.substring(1));
                if (path.equals("__catalog.json")) {
                    CatalogScanner scanner;
                    try {
                        scanner = catalogFor(active);
                    } catch (RuntimeException first) {
                        active.invalidateCache();
                        invalidateCatalog(false);
                        scanner = catalogFor(active);
                    }
                    return response("application/json", scanner.toCatalogJson().getBytes(StandardCharsets.UTF_8));
                }
                WebResourceResponse served = null;
                Throwable failure = null;
                try {
                    served = fileResponse(active, path);
                } catch (Exception first) {
                    failure = first;
                }
                if (served == null) {
                    active.invalidateCache();
                    invalidateCatalog(false);
                    try {
                        served = fileResponse(active, path);
                    } catch (Exception second) {
                        failure = second;
                    }
                }
                if (served != null) return served;
                if (failure == null) failure = new FileNotFoundException(path);
                requestStorageRecovery(this, view, active, failure, request.isForMainFrame());
                return errorResponse(failure instanceof FileNotFoundException ? 404 : 503, failure instanceof FileNotFoundException ? "Not found" : "Arcade folder unavailable");
            } catch (Exception error) {
                requestStorageRecovery(this, view, active, error, request.isForMainFrame());
                return errorResponse(503, "Arcade folder unavailable");
            }
        }

        private WebResourceResponse fileResponse(ArcadeStorage active, String path) throws Exception {
            ArcadeStorage.Doc doc = active.resolveRequired(path);
            if (doc == null || doc.isDirectory()) return null;
            InputStream input = active.open(doc.uri);
            if (input == null) return null;
            String mime = ArcadeStorage.mimeForName(doc.name);
            String encoding = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg") ? "UTF-8" : null;
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store, max-age=0");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, input);
        }

        private WebResourceResponse response(String mime, byte[] bytes) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store, max-age=0");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, new ByteArrayInputStream(bytes));
        }

        private WebResourceResponse errorResponse(int code, String text) {
            return new WebResourceResponse("text/plain", "UTF-8", code, text, new HashMap<String, String>(), new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return shouldBlockUrl(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            try {
                return shouldBlockUrl(Uri.parse(url));
            } catch (Exception error) {
                return true;
            }
        }

        private boolean shouldBlockUrl(Uri uri) {
            if (boundRemote) return !isRemoteArcadeUri(uri);
            return uri == null || !("https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost()));
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (boundRemote && request.isForMainFrame() && isRemoteArcadeUri(request.getUrl())) requestRemoteRecovery(this, view);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (boundRemote && request.isForMainFrame() && isRemoteArcadeUri(request.getUrl()) && errorResponse.getStatusCode() >= 400) requestRemoteRecovery(this, view);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view != boundView || view != webView || boundRemote != remoteMode || (!boundRemote && boundStorage != storage)) return;
            Uri finished = url == null ? null : Uri.parse(url);
            if (!boundRemote || !isRemoteHomeUri(finished)) {
                if (progress != null) progress.setVisibility(View.GONE);
            }
            try { view.requestFocus(View.FOCUS_DOWN); } catch (RuntimeException ignored) {}
        }
    }

    @TargetApi(Build.VERSION_CODES.O)
    private final class LocalClientApi26 extends LocalClient {
        LocalClientApi26(WebView boundView, ArcadeStorage boundStorage, boolean boundRemote, boolean boundOffline, int boundGeneration) {
            super(boundView, boundStorage, boundRemote, boundOffline, boundGeneration);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            handleRendererGone(view, detail.didCrash());
            return true;
        }
    }

    private WebResourceResponse serviceWorkerResponse(WebResourceRequest request) {
        if (destroyed || !remoteMode || !forceOffline || request == null || !isRemoteArcadeUri(request.getUrl())) return null;
        OfflineArchiveManager manager = offlineArchive;
        WebResourceResponse response = manager == null ? null : manager.responseFor(request.getUrl());
        if (response != null) return response;
        String text = "Not in the validated offline Arcade";
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store, max-age=0");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers, new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    @TargetApi(Build.VERSION_CODES.N)
    private static final class ServiceWorkerApi24 {
        private static WeakReference<MainActivity> owner = new WeakReference<>(null);

        static synchronized void install(MainActivity activity) {
            WeakReference<MainActivity> reference = new WeakReference<>(activity);
            owner = reference;
            ServiceWorkerController controller = ServiceWorkerController.getInstance();
            controller.getServiceWorkerWebSettings().setBlockNetworkLoads(false);
            controller.setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    MainActivity current = reference.get();
                    return current == null ? null : current.serviceWorkerResponse(request);
                }
            });
        }

        static synchronized void clear(MainActivity activity) {
            if (owner.get() != activity) return;
            ServiceWorkerController.getInstance().setServiceWorkerClient(null);
            owner.clear();
        }
    }

    private void handleRendererGone(WebView view, boolean crashed) {
        Log.e("Arcade", "WebView renderer stopped. crashed=" + crashed);
        if (destroyed) {
            try { view.destroy(); } catch (Exception ignored) {}
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (rendererCrashWindow == 0 || now - rendererCrashWindow > 60000) {
            rendererCrashWindow = now;
            rendererCrashCount = 0;
        }
        rendererCrashCount++;
        if (view == webView) {
            ArcadeStorage active = storage;
            boolean wasRemote = remoteMode;
            boolean retry = rendererCrashCount == 1;
            destroyRendererWebView(view);
            root.post(() -> {
                if (destroyed || webView != null || storage != active || remoteMode != wasRemote) return;
                if (retry && (wasRemote || (active != null && active.hasPersistedAccess() && active.available())) && showWebView()) loadHome();
                else if (wasRemote) showRemoteRecoveryScreen("The online Arcade viewer stopped unexpectedly.");
                else showViewerRecoveryScreen("The Arcade viewer stopped unexpectedly.");
            });
        } else {
            try { root.removeView(view); } catch (Exception ignored) {}
            try { view.destroy(); } catch (Exception ignored) {}
        }
    }

    private void destroyRendererWebView(WebView dead) {
        if (dead != webView) {
            try { root.removeView(dead); } catch (Exception ignored) {}
            try { dead.destroy(); } catch (Exception ignored) {}
            return;
        }
        WebView old = webView;
        ProgressBar oldProgress = progress;
        LocalClient oldClient = activeClient;
        webView = null;
        activeClient = null;
        progress = null;
        webGeneration = 0;
        webReady = false;
        loaded = false;
        if (oldClient != null) oldClient.cancelRecovery();
        pendingFileChooser = null;
        pendingAudioPermission = null;
        if (oldProgress != null) {
            try { root.removeView(oldProgress); } catch (Exception ignored) {}
        }
        try { root.removeView(old); } catch (Exception ignored) {}
        try { old.destroy(); } catch (Exception ignored) {}
    }

    private final class ArcadeChrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                Uri origin = request.getOrigin();
                boolean local = origin != null && "https".equalsIgnoreCase(origin.getScheme()) && origin.getPort() == -1 && (HOST.equalsIgnoreCase(origin.getHost()) || REMOTE_HOST.equalsIgnoreCase(origin.getHost()));
                boolean audio = false;
                for (String resource : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                if (!local || !audio) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingAudioPermission = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, RECORD_AUDIO_REQUEST);
                }
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingAudioPermission == request) pendingAudioPermission = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
            pendingFileChooser = callback;
            Intent intent;
            try {
                intent = params.createIntent();
            } catch (Exception error) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*");
            }
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            try {
                startActivityForResult(intent, PICK_WEB_FILE);
            } catch (RuntimeException error) {
                Log.e("Arcade", "File picker could not open", error);
                pendingFileChooser = null;
                try { callback.onReceiveValue(null); } catch (RuntimeException ignored) {}
                message("Android could not open the file picker.");
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e("ArcadeWeb", message.sourceId() + ":" + message.lineNumber() + " " + message.message());
            return true;
        }
    }
}
