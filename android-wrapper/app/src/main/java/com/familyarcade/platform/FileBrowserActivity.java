package com.familyarcade.platform;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class FileBrowserActivity extends BaseActivity {
    private ArcadeStorage storage;
    private ArcadeStorage.Doc gameFolder;
    private ArcadeStorage.Doc currentFolder;
    private String gameFolderName;
    private String entryFile;
    private final ArrayList<ArcadeStorage.Doc> files = new ArrayList<>();
    private final ArrayList<String> pathParts = new ArrayList<>();
    private ListView list;
    private TextView path;
    private FileAdapter adapter;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        storage = ArcadeStorage.fromPreferences(this);
        String value = getIntent().getStringExtra("folderUri");
        gameFolderName = getIntent().getStringExtra("folderName");
        entryFile = getIntent().getStringExtra("entry");
        if (storage == null || value == null) {
            finish();
            return;
        }
        gameFolder = storage.queryDoc(Uri.parse(value));
        currentFolder = gameFolder;
        if (gameFolder == null || !gameFolder.isDirectory()) {
            message("Game folder is unavailable.");
            finish();
            return;
        }
        if (gameFolderName == null) gameFolderName = gameFolder.name;
        if (entryFile == null || entryFile.isEmpty()) entryFile = "index.html";
        buildUi();
        refresh();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);
        root.setPadding(Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8));
        LinearLayout top = Ui.row(this);
        Button back = Ui.button(this, "‹ Back");
        back.setOnClickListener(v -> up());
        TextView title = Ui.title(this, "Files");
        title.setPadding(Ui.dp(this, 10), 0, 0, 0);
        Button preview = Ui.button(this, "Preview");
        preview.setOnClickListener(v -> preview());
        Button newFolder = Ui.button(this, "+ Folder");
        newFolder.setOnClickListener(v -> createFolder());
        Button newFile = Ui.button(this, "+ File");
        newFile.setBackground(Ui.background(Color.rgb(16, 117, 146), Ui.CYAN, 12, this));
        newFile.setOnClickListener(v -> createFile());
        top.addView(back);
        top.addView(title, Ui.weight(1));
        top.addView(preview);
        top.addView(space());
        top.addView(newFolder);
        top.addView(space());
        top.addView(newFile);
        root.addView(top);
        path = Ui.text(this, "", 12, Ui.MUTED, true);
        path.setPadding(Ui.dp(this, 4), 0, 0, Ui.dp(this, 6));
        root.addView(path);
        list = new ListView(this);
        list.setDivider(null);
        list.setDividerHeight(Ui.dp(this, 6));
        adapter = new FileAdapter();
        list.setAdapter(adapter);
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private View space() {
        return Ui.text(this, " ", 1, Color.TRANSPARENT, false);
    }

    private boolean refresh() {
        storage.invalidateCache();
        List<ArcadeStorage.Doc> refreshed;
        try {
            refreshed = storage.listRequired(currentFolder.uri);
        } catch (RuntimeException error) {
            message("Android could not refresh this folder. Try again.");
            return false;
        }
        files.clear();
        for (ArcadeStorage.Doc file : refreshed) {
            if (file.name.equals(ArcadeStorage.BACKUP_FOLDER)) continue;
            files.add(file);
        }
        StringBuilder shownPath = new StringBuilder(gameFolder.name);
        for (String part : pathParts) shownPath.append(" / ").append(part);
        path.setText(shownPath.toString() + " • " + files.size() + " items");
        adapter.notifyDataSetChanged();
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (storage != null && currentFolder != null && list != null) refresh();
    }

    private void up() {
        if (pathParts.isEmpty()) {
            finish();
            return;
        }
        ArrayList<String> targetParts = new ArrayList<>(pathParts);
        targetParts.remove(targetParts.size() - 1);
        ArcadeStorage.Doc targetFolder = gameFolder;
        try {
            storage.invalidateCache();
            for (String part : targetParts) {
                ArcadeStorage.Doc child = storage.childRequired(targetFolder.uri, part);
                if (child == null || !child.isDirectory()) throw new IOException("Folder is unavailable.");
                targetFolder = child;
            }
        } catch (Exception error) {
            message("Android could not open the parent folder. Try again.");
            return;
        }
        ArcadeStorage.Doc oldFolder = currentFolder;
        ArrayList<String> oldParts = new ArrayList<>(pathParts);
        currentFolder = targetFolder;
        pathParts.clear();
        pathParts.addAll(targetParts);
        if (!refresh()) {
            currentFolder = oldFolder;
            pathParts.clear();
            pathParts.addAll(oldParts);
        }
    }

    @Override
    public void onBackPressed() {
        up();
    }

    private String relativeName(String leaf) {
        StringBuilder result = new StringBuilder();
        for (String part : pathParts) {
            if (result.length() > 0) result.append('/');
            result.append(part);
        }
        if (result.length() > 0) result.append('/');
        result.append(leaf);
        return result.toString();
    }

    private void open(ArcadeStorage.Doc file) {
        if (file.isDirectory()) {
            ArcadeStorage.Doc oldFolder = currentFolder;
            currentFolder = file;
            pathParts.add(file.name);
            if (!refresh()) {
                currentFolder = oldFolder;
                pathParts.remove(pathParts.size() - 1);
            }
            return;
        }
        if (ArcadeStorage.editable(file.name)) {
            Intent intent = new Intent(this, EditorActivity.class);
            intent.putExtra("fileUri", file.uri.toString());
            intent.putExtra("parentUri", currentFolder.uri.toString());
            intent.putExtra("gameFolderUri", gameFolder.uri.toString());
            intent.putExtra("relativeName", relativeName(file.name));
            intent.putExtra("previewPath", gameFolderName + "/" + entryFile);
            startActivity(intent);
        } else {
            previewBinary(file);
        }
    }

    private void previewBinary(ArcadeStorage.Doc file) {
        String mime = ArcadeStorage.mimeForName(file.name);
        if (mime.startsWith("image/")) {
            try {
                byte[] bytes = storage.readBytes(file.uri, 12 * 1024 * 1024);
                Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) throw new IOException("Unsupported image.");
                ImageView image = new ImageView(this);
                image.setImageBitmap(bitmap);
                image.setAdjustViewBounds(true);
                image.setScaleType(ImageView.ScaleType.FIT_CENTER);
                int pad = Ui.dp(this, 14);
                image.setPadding(pad, pad, pad, pad);
                new AlertDialog.Builder(this).setTitle(file.name).setView(image).setPositiveButton("Done", null).show();
            } catch (Exception error) {
                message("Preview failed: " + error.getMessage());
            }
            return;
        }
        if (mime.startsWith("audio/")) {
            try {
                MediaPlayer player = new MediaPlayer();
                player.setDataSource(this, file.uri);
                player.prepare();
                LinearLayout controls = new LinearLayout(this);
                controls.setPadding(Ui.dp(this, 16), Ui.dp(this, 10), Ui.dp(this, 16), Ui.dp(this, 10));
                controls.setGravity(Gravity.CENTER);
                Button play = Ui.button(this, "Play / Pause");
                play.setOnClickListener(v -> { if (player.isPlaying()) player.pause(); else player.start(); });
                controls.addView(play);
                AlertDialog dialog = new AlertDialog.Builder(this).setTitle(file.name).setMessage(sizeText(file.size)).setView(controls).setPositiveButton("Done", null).create();
                dialog.setOnDismissListener(d -> player.release());
                dialog.show();
            } catch (Exception error) {
                message("Audio preview failed: " + error.getMessage());
            }
            return;
        }
        new AlertDialog.Builder(this).setTitle(file.name).setMessage("Type: " + mime + "\nSize: " + sizeText(file.size)).setPositiveButton("Done", null).show();
    }

    private String sizeText(long bytes) {
        if (bytes >= 1024 * 1024) return String.format(Locale.US, "%.1f MB", bytes / 1048576f);
        if (bytes >= 1024) return String.format(Locale.US, "%.1f KB", bytes / 1024f);
        return bytes + " bytes";
    }

    private void createFile() {
        EditText name = Ui.input(this, "style.css");
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(Ui.dp(this, 20), 0, Ui.dp(this, 20), 0);
        wrap.addView(name);
        new AlertDialog.Builder(this)
            .setTitle("New source file")
            .setView(wrap)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Create", (dialog, which) -> {
                String value = name.getText().toString().trim();
                if (!validLeaf(value)) {
                    message("Use a simple filename with an extension.");
                    return;
                }
                try {
                    ArcadeStorage.Doc file = storage.createFile(currentFolder.uri, value, ArcadeStorage.mimeForName(value));
                    if (file == null) throw new IOException("Creation failed.");
                    storage.overwriteText(file.uri, "");
                    ArcadeStorage.markDirty(this);
                    refresh();
                    open(file);
                } catch (Exception error) {
                    message("Could not create file: " + error.getMessage());
                }
            })
            .show();
    }

    private void createFolder() {
        EditText name = Ui.input(this, "assets");
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(Ui.dp(this, 20), 0, Ui.dp(this, 20), 0);
        wrap.addView(name);
        new AlertDialog.Builder(this)
            .setTitle("New folder")
            .setView(wrap)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Create", (dialog, which) -> {
                String value = name.getText().toString().trim();
                if (!validLeaf(value)) {
                    message("Use a simple folder name.");
                    return;
                }
                try {
                    if (storage.createDirectory(currentFolder.uri, value) == null) throw new IOException("Creation failed.");
                    ArcadeStorage.markDirty(this);
                    refresh();
                } catch (Exception error) {
                    message("Could not create folder: " + error.getMessage());
                }
            })
            .show();
    }

    private boolean validLeaf(String value) {
        return !value.isEmpty() && !value.equals(".") && !value.equals("..") && !value.contains("/") && !value.contains("\\");
    }

    private void confirmDelete(ArcadeStorage.Doc file) {
        new AlertDialog.Builder(this)
            .setTitle("Delete " + file.name + "?")
            .setMessage(file.isDirectory() ? "Folders can only be deleted when empty." : "A recovery copy will be placed in __backups__.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete", (dialog, which) -> delete(file))
            .show();
    }

    private void delete(ArcadeStorage.Doc file) {
        try {
            if (!file.isDirectory()) {
                byte[] bytes = storage.readBytes(file.uri, 16 * 1024 * 1024);
                ArcadeStorage.Doc backups = storage.ensureDirectory(gameFolder.uri, ArcadeStorage.BACKUP_FOLDER);
                ArcadeStorage.Doc backup = storage.ensureFile(backups.uri, relativeName(file.name).replace("/", "__") + ".deleted", file.mime);
                if (backup == null) throw new IOException("Backup creation failed.");
                storage.overwrite(backup.uri, new ByteArrayInputStream(bytes));
            }
            if (!storage.delete(file.uri)) throw new IOException("Android refused the deletion.");
            ArcadeStorage.markDirty(this);
            refresh();
        } catch (Exception error) {
            message("Delete failed: " + error.getMessage());
        }
    }

    private void preview() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("openPath", gameFolderName + "/" + entryFile);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
    }

    private final class FileAdapter extends BaseAdapter {
        @Override public int getCount() { return files.size(); }
        @Override public ArcadeStorage.Doc getItem(int position) { return files.get(position); }
        @Override public long getItemId(int position) { return getItem(position).uri.toString().hashCode(); }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            ArcadeStorage.Doc file = getItem(position);
            LinearLayout row = new LinearLayout(FileBrowserActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(Ui.dp(FileBrowserActivity.this, 10), Ui.dp(FileBrowserActivity.this, 7), Ui.dp(FileBrowserActivity.this, 10), Ui.dp(FileBrowserActivity.this, 7));
            row.setBackground(Ui.background(Ui.PANEL, Color.rgb(52, 65, 104), 13, FileBrowserActivity.this));
            TextView symbol = Ui.text(FileBrowserActivity.this, file.isDirectory() ? "▣" : ArcadeStorage.editable(file.name) ? "</>" : "●", file.isDirectory() ? 24 : 15, file.isDirectory() ? Ui.GOLD : Ui.CYAN, true);
            symbol.setGravity(Gravity.CENTER);
            row.addView(symbol, new LinearLayout.LayoutParams(Ui.dp(FileBrowserActivity.this, 48), Ui.dp(FileBrowserActivity.this, 44)));
            LinearLayout copy = new LinearLayout(FileBrowserActivity.this);
            copy.setOrientation(LinearLayout.VERTICAL);
            copy.addView(Ui.text(FileBrowserActivity.this, file.name, 15, Ui.TEXT, true));
            copy.addView(Ui.text(FileBrowserActivity.this, file.isDirectory() ? "Folder" : sizeText(file.size) + " • " + ArcadeStorage.mimeForName(file.name), 11, Ui.MUTED, false));
            row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            TextView arrow = Ui.text(FileBrowserActivity.this, "›", 28, Ui.MUTED, true);
            arrow.setGravity(Gravity.CENTER);
            row.addView(arrow, new LinearLayout.LayoutParams(Ui.dp(FileBrowserActivity.this, 34), Ui.dp(FileBrowserActivity.this, 44)));
            row.setOnClickListener(v -> open(file));
            row.setOnLongClickListener(v -> { confirmDelete(file); return true; });
            return row;
        }
    }
}
