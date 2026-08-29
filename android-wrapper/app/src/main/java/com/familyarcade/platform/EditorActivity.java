package com.familyarcade.platform;

import android.app.AlertDialog;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

public final class EditorActivity extends BaseActivity {
    private static final int IMPORT_REPLACEMENT = 90;
    private ArcadeStorage storage;
    private Uri fileUri;
    private Uri parentUri;
    private Uri gameFolderUri;
    private String relativeName;
    private String previewPath;
    private CodeEditText editor;
    private TextView status;
    private String savedText = "";
    private final ArrayList<String> history = new ArrayList<>();
    private int historyIndex;
    private boolean internalChange;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable captureRunnable = this::captureHistory;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        storage = ArcadeStorage.fromPreferences(this);
        String fileValue = getIntent().getStringExtra("fileUri");
        String parentValue = getIntent().getStringExtra("parentUri");
        String gameValue = getIntent().getStringExtra("gameFolderUri");
        relativeName = getIntent().getStringExtra("relativeName");
        previewPath = getIntent().getStringExtra("previewPath");
        if (storage == null || fileValue == null || gameValue == null) {
            finish();
            return;
        }
        fileUri = Uri.parse(fileValue);
        gameFolderUri = Uri.parse(gameValue);
        parentUri = parentValue == null ? gameFolderUri : Uri.parse(parentValue);
        if (relativeName == null) relativeName = "source.txt";
        try {
            savedText = storage.readText(fileUri);
        } catch (Exception error) {
            message("Could not open file: " + error.getMessage());
            finish();
            return;
        }
        buildUi();
        setText(savedText, true);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);
        root.setPadding(Ui.dp(this, 7), Ui.dp(this, 7), Ui.dp(this, 7), Ui.dp(this, 5));

        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout tools = new LinearLayout(this);
        tools.setOrientation(LinearLayout.HORIZONTAL);
        tools.setGravity(Gravity.CENTER_VERTICAL);
        addTool(tools, "‹ Files", v -> leave());
        addTool(tools, "Save", v -> save(true));
        addTool(tools, "Save & Preview", v -> preview());
        addTool(tools, "Undo", v -> undo());
        addTool(tools, "Redo", v -> redo());
        addTool(tools, "Find / Replace", v -> findDialog());
        addTool(tools, "Select All", v -> editor.selectAll());
        addTool(tools, "Replace Entire File", v -> replaceEntireFile());
        addTool(tools, "Save As", v -> saveAs());
        addTool(tools, "Restore Previous", v -> restorePrevious());
        scroll.addView(tools, new HorizontalScrollView.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 46)));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 48)));

        status = Ui.text(this, "", 11, Ui.MUTED, true);
        status.setPadding(Ui.dp(this, 5), 0, Ui.dp(this, 5), Ui.dp(this, 4));
        root.addView(status);
        editor = new CodeEditText(this);
        editor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        editor.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                updateStatus();
                if (!internalChange) {
                    handler.removeCallbacks(captureRunnable);
                    handler.postDelayed(captureRunnable, 550);
                }
            }
            @Override public void afterTextChanged(Editable s) {}
        });
        root.addView(editor, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private void addTool(LinearLayout tools, String label, View.OnClickListener listener) {
        Button button = Ui.button(this, label);
        if (label.equals("Save") || label.equals("Save & Preview")) button.setBackground(Ui.background(Color.rgb(18, 119, 83), Ui.GREEN, 11, this));
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 41));
        params.setMargins(0, 0, Ui.dp(this, 6), 0);
        tools.addView(button, params);
    }

    private void setText(String text, boolean resetHistory) {
        internalChange = true;
        editor.setText(text);
        editor.setSelection(Math.min(text.length(), editor.getText().length()));
        internalChange = false;
        if (resetHistory) {
            history.clear();
            history.add(text);
            historyIndex = 0;
        }
        updateStatus();
    }

    private void updateStatus() {
        if (status == null || editor == null) return;
        String text = editor.getText().toString();
        int lines = Math.max(1, editor.getLineCount());
        status.setText(relativeName + " • " + lines + " lines • " + text.length() + " characters" + (text.equals(savedText) ? "" : " • Modified"));
        status.setTextColor(text.equals(savedText) ? Ui.MUTED : Ui.GOLD);
    }

    private void captureHistory() {
        if (internalChange) return;
        String text = editor.getText().toString();
        if (historyIndex >= 0 && historyIndex < history.size() && history.get(historyIndex).equals(text)) return;
        while (history.size() > historyIndex + 1) history.remove(history.size() - 1);
        history.add(text);
        if (history.size() > 20) history.remove(0); else historyIndex++;
        historyIndex = history.size() - 1;
    }

    private void undo() {
        handler.removeCallbacks(captureRunnable);
        captureHistory();
        if (historyIndex <= 0) return;
        historyIndex--;
        setHistoryText(history.get(historyIndex));
    }

    private void redo() {
        handler.removeCallbacks(captureRunnable);
        if (historyIndex >= history.size() - 1) return;
        historyIndex++;
        setHistoryText(history.get(historyIndex));
    }

    private void setHistoryText(String text) {
        int cursor = editor.getSelectionStart();
        internalChange = true;
        editor.setText(text);
        editor.setSelection(Math.min(Math.max(0, cursor), text.length()));
        internalChange = false;
        updateStatus();
    }

    private boolean validateSource(String text) {
        return validateSource(text, relativeName);
    }

    private boolean validateSource(String text, String name) {
        if (!name.toLowerCase().endsWith(".json")) return true;
        try {
            JSONTokener tokener = new JSONTokener(text);
            Object parsed = tokener.nextValue();
            if (parsed == null || tokener.nextClean() != 0) throw new IllegalArgumentException("JSON contains trailing or invalid content.");
            if (name.equalsIgnoreCase("game.json")) {
                if (!(parsed instanceof JSONObject)) throw new IllegalArgumentException("game.json must contain a JSON object.");
                GameMetadata metadata = GameMetadata.fromJson(text);
                String error = metadata.validationError();
                if (error != null) throw new IllegalArgumentException(error);
            }
            return true;
        } catch (Exception error) {
            new AlertDialog.Builder(this).setTitle("Invalid JSON").setMessage(error.getMessage()).setPositiveButton("OK", null).show();
            return false;
        }
    }

    private boolean save(boolean notify) {
        String text = editor.getText().toString();
        if (!validateSource(text)) return false;
        try {
            storage.writeWithBackup(gameFolderUri, relativeName, fileUri, text);
            savedText = text;
            ArcadeStorage.markDirty(this);
            updateStatus();
            if (notify) message("Saved with recovery backup.");
            return true;
        } catch (Exception error) {
            message("Save failed: " + error.getMessage());
            return false;
        }
    }

    private void preview() {
        if (!save(false)) return;
        if (previewPath == null || previewPath.isEmpty()) {
            message("No preview entry is configured.");
            return;
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("openPath", previewPath);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
    }

    private void leave() {
        if (editor.getText().toString().equals(savedText)) {
            finish();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("Unsaved changes")
            .setItems(new String[]{"Save and Leave", "Discard Changes", "Keep Editing"}, (dialog, which) -> {
                if (which == 0 && save(false)) finish();
                if (which == 1) finish();
            })
            .show();
    }

    @Override
    public void onBackPressed() {
        leave();
    }

    private void findDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(Ui.dp(this, 20), 0, Ui.dp(this, 20), 0);
        EditText find = Ui.input(this, "Find");
        EditText replace = Ui.input(this, "Replace with");
        CheckBox matchCase = new CheckBox(this);
        matchCase.setText("Match case");
        matchCase.setTextColor(Ui.TEXT);
        form.addView(find);
        form.addView(replace);
        form.addView(matchCase);
        Button replaceCurrent = Ui.button(this, "Replace Current");
        replaceCurrent.setOnClickListener(v -> replaceSelection(find.getText().toString(), replace.getText().toString(), matchCase.isChecked()));
        LinearLayout.LayoutParams replaceParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 42));
        replaceParams.setMargins(0, Ui.dp(this, 6), 0, 0);
        form.addView(replaceCurrent, replaceParams);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Find and Replace")
            .setView(form)
            .setNegativeButton("Done", null)
            .setNeutralButton("Replace All", null)
            .setPositiveButton("Find Next", null)
            .create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> findNext(find.getText().toString(), matchCase.isChecked()));
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> replaceAll(find.getText().toString(), replace.getText().toString(), matchCase.isChecked()));
        });
        dialog.show();
    }

    private int indexOf(String text, String needle, int start, boolean matchCase) {
        if (needle.isEmpty()) return -1;
        if (matchCase) return text.indexOf(needle, start);
        return text.toLowerCase().indexOf(needle.toLowerCase(), start);
    }

    private void findNext(String needle, boolean matchCase) {
        String text = editor.getText().toString();
        int start = Math.max(editor.getSelectionEnd(), 0);
        int found = indexOf(text, needle, start, matchCase);
        if (found < 0 && start > 0) found = indexOf(text, needle, 0, matchCase);
        if (found < 0) {
            message("No match.");
            return;
        }
        editor.requestFocus();
        editor.setSelection(found, found + needle.length());
    }

    private void replaceSelection(String needle, String replacement, boolean matchCase) {
        int start = editor.getSelectionStart();
        int end = editor.getSelectionEnd();
        if (start >= 0 && end > start) {
            String selected = editor.getText().subSequence(start, end).toString();
            if ((matchCase && selected.equals(needle)) || (!matchCase && selected.equalsIgnoreCase(needle))) editor.getText().replace(start, end, replacement);
        }
        findNext(needle, matchCase);
    }

    private void replaceAll(String needle, String replacement, boolean matchCase) {
        if (needle.isEmpty()) return;
        String text = editor.getText().toString();
        StringBuilder result = new StringBuilder();
        int cursor = 0;
        int count = 0;
        while (true) {
            int found = indexOf(text, needle, cursor, matchCase);
            if (found < 0) break;
            result.append(text, cursor, found).append(replacement);
            cursor = found + needle.length();
            count++;
        }
        if (count == 0) {
            message("No matches.");
            return;
        }
        result.append(text.substring(cursor));
        setHistoryText(result.toString());
        captureHistory();
        message("Replaced " + count + " matches.");
    }

    private void replaceEntireFile() {
        new AlertDialog.Builder(this)
            .setTitle("Replace Entire File")
            .setItems(new String[]{"Paste from Clipboard", "Import a Text File", "Clear Editor"}, (dialog, which) -> {
                if (which == 0) pasteReplacement();
                if (which == 1) importReplacement();
                if (which == 2) confirmReplacement("");
            })
            .show();
    }

    private void pasteReplacement() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || !clipboard.hasPrimaryClip() || clipboard.getPrimaryClip() == null || clipboard.getPrimaryClip().getItemCount() == 0) {
            message("Clipboard is empty.");
            return;
        }
        CharSequence text = clipboard.getPrimaryClip().getItemAt(0).coerceToText(this);
        confirmReplacement(text == null ? "" : text.toString());
    }

    private void importReplacement() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/*");
        startActivityForResult(intent, IMPORT_REPLACEMENT);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != IMPORT_REPLACEMENT || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        try (InputStream input = getContentResolver().openInputStream(data.getData())) {
            if (input == null) throw new IOException("File could not be opened.");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 8 * 1024 * 1024) throw new IOException("Replacement is larger than 8 MB.");
                output.write(buffer, 0, count);
            }
            confirmReplacement(new String(output.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception error) {
            message("Import failed: " + error.getMessage());
        }
    }

    private void confirmReplacement(String replacement) {
        new AlertDialog.Builder(this)
            .setTitle("Replace all editor contents?")
            .setMessage("The existing file is not overwritten until you tap Save.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Replace", (dialog, which) -> {
                setHistoryText(replacement);
                captureHistory();
                editor.requestFocus();
            })
            .show();
    }

    private void saveAs() {
        EditText name = Ui.input(this, leafName(relativeName));
        name.setText(leafName(relativeName));
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(Ui.dp(this, 20), 0, Ui.dp(this, 20), 0);
        wrap.addView(name);
        new AlertDialog.Builder(this)
            .setTitle("Save As")
            .setView(wrap)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save", (dialog, which) -> {
                String value = name.getText().toString().trim();
                if (value.isEmpty() || value.contains("/") || value.contains("\\") || value.equals(".") || value.equals("..")) {
                    message("Use a simple filename.");
                    return;
                }
                if (!validateSource(editor.getText().toString(), value)) return;
                try {
                    ArcadeStorage.Doc existing = storage.childRequired(parentUri, value);
                    if (existing != null) {
                        message("That filename already exists.");
                        return;
                    }
                    ArcadeStorage.Doc created = storage.createFile(parentUri, value, ArcadeStorage.mimeForName(value));
                    if (created == null) throw new IOException("File creation failed.");
                    fileUri = created.uri;
                    String prefix = relativeName.contains("/") ? relativeName.substring(0, relativeName.lastIndexOf('/') + 1) : "";
                    relativeName = prefix + value;
                    storage.overwriteText(fileUri, editor.getText().toString());
                    savedText = editor.getText().toString();
                    ArcadeStorage.markDirty(this);
                    updateStatus();
                    message("Saved as " + value + ".");
                } catch (Exception error) {
                    message("Save As failed: " + error.getMessage());
                }
            })
            .show();
    }

    private String leafName(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? path : path.substring(slash + 1);
    }

    private void restorePrevious() {
        try {
            String previous = storage.readBackup(gameFolderUri, relativeName);
            if (previous == null) {
                message("No previous version is available.");
                return;
            }
            new AlertDialog.Builder(this)
                .setTitle("Restore previous version?")
                .setMessage("The restored text will appear in the editor. Tap Save to keep it.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Restore", (dialog, which) -> {
                    setHistoryText(previous);
                    captureHistory();
                })
                .show();
        } catch (Exception error) {
            message("Restore failed: " + error.getMessage());
        }
    }
}
