package com.familyarcade.platform;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

public final class MetadataActivity extends BaseActivity {
    private static final int PICK_ICON = 70;
    private ArcadeStorage storage;
    private ArcadeStorage.Doc folder;
    private ArcadeStorage.Doc metadataFile;
    private GameMetadata metadata;
    private EditText title;
    private CheckBox enabled;
    private Spinner type;
    private Spinner capability;
    private EditText playersMin;
    private EditText playersMax;
    private Spinner orientation;
    private LinearLayout categoryList;
    private final LinkedHashMap<String, CheckBox> categoryChecks = new LinkedHashMap<>();
    private EditText tags;
    private EditText entry;
    private EditText icon;
    private EditText order;
    private LinearLayout advanced;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        storage = ArcadeStorage.fromPreferences(this);
        String folderValue = getIntent().getStringExtra("folderUri");
        if (storage == null || folderValue == null) {
            finish();
            return;
        }
        folder = storage.queryDoc(Uri.parse(folderValue));
        if (folder == null || !folder.isDirectory()) {
            message("Game folder is unavailable.");
            finish();
            return;
        }
        if (!loadMetadata()) {
            message("Android could not read this item's metadata. Try again.");
            finish();
            return;
        }
        buildUi();
    }

    private boolean loadMetadata() {
        try {
            storage.invalidateCache();
            metadataFile = storage.childRequired(folder.uri, "game.json");
            if (metadataFile != null) {
                String text = storage.readText(metadataFile.uri);
                try {
                    metadata = GameMetadata.fromJson(text);
                    return true;
                } catch (JSONException ignored) {}
            }
            int bottom = 10;
            CatalogScanner scanner = new CatalogScanner(storage);
            for (CatalogScanner.Entry item : scanner.scan()) bottom = Math.max(bottom, item.metadata.order + 10);
            ArcadeStorage.Doc likely = storage.childRequired(folder.uri, "index.html");
            if (likely == null) {
                for (ArcadeStorage.Doc child : storage.listRequired(folder.uri)) {
                    if (!child.isDirectory() && child.name.toLowerCase(Locale.US).endsWith(".html")) {
                        likely = child;
                        break;
                    }
                }
            }
            metadata = GameMetadata.inferred(folder.name, likely == null ? "index.html" : likely.name, bottom);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);
        root.setPadding(Ui.dp(this, 10), Ui.dp(this, 8), Ui.dp(this, 10), Ui.dp(this, 8));
        LinearLayout bar = Ui.row(this);
        Button back = Ui.button(this, "‹ Back");
        back.setOnClickListener(v -> finish());
        TextView heading = Ui.title(this, metadataFile == null ? "Create Metadata" : "Edit Metadata");
        heading.setPadding(Ui.dp(this, 10), 0, 0, 0);
        Button files = Ui.button(this, "Files");
        files.setOnClickListener(v -> {
            Intent intent = new Intent(this, FileBrowserActivity.class);
            intent.putExtra("folderUri", folder.uri.toString());
            intent.putExtra("folderName", folder.name);
            intent.putExtra("entry", entry == null ? metadata.entry : entry.getText().toString());
            startActivity(intent);
        });
        Button save = Ui.button(this, "Save");
        save.setBackground(Ui.background(Color.rgb(18, 119, 83), Ui.GREEN, 12, this));
        save.setOnClickListener(v -> save());
        bar.addView(back);
        bar.addView(heading, Ui.weight(1));
        bar.addView(files);
        bar.addView(Ui.text(this, " ", 1, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 6), 1));
        bar.addView(save);
        root.addView(bar);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(Ui.dp(this, 2), 0, Ui.dp(this, 2), Ui.dp(this, 18));

        form.addView(Ui.label(this, "Title"));
        title = Ui.input(this, "Title");
        title.setText(metadata.title);
        form.addView(title);

        LinearLayout mainOptions = Ui.row(this);
        enabled = new CheckBox(this);
        enabled.setText("Enabled");
        enabled.setTextColor(Ui.TEXT);
        enabled.setChecked(metadata.enabled);
        type = spinner(new String[]{"Game", "Activity"});
        type.setSelection(metadata.type.equals("activity") ? 1 : 0);
        mainOptions.addView(enabled, Ui.weight(1));
        mainOptions.addView(type, Ui.weight(1));
        form.addView(mainOptions);

        form.addView(Ui.label(this, "Player capability"));
        capability = spinner(new String[]{"Single player", "Two-player same-device", "One or two players", "Custom range"});
        capability.setSelection(capabilityIndex());
        form.addView(capability);
        LinearLayout range = Ui.row(this);
        playersMin = Ui.input(this, "Min players");
        playersMin.setInputType(InputType.TYPE_CLASS_NUMBER);
        playersMin.setText(String.valueOf(metadata.playersMin));
        playersMax = Ui.input(this, "Max players");
        playersMax.setInputType(InputType.TYPE_CLASS_NUMBER);
        playersMax.setText(String.valueOf(metadata.playersMax));
        range.addView(playersMin, Ui.weight(1));
        range.addView(Ui.text(this, " to ", 14, Ui.MUTED, true));
        range.addView(playersMax, Ui.weight(1));
        form.addView(range);
        capability.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                if (position == 0) setRange(1, 1);
                if (position == 1) setRange(2, 2);
                if (position == 2) setRange(1, 2);
                boolean custom = position == 3;
                playersMin.setEnabled(custom);
                playersMax.setEnabled(custom);
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });

        form.addView(Ui.label(this, "Preferred orientation"));
        orientation = spinner(new String[]{"Any orientation", "Landscape", "Portrait"});
        orientation.setSelection(metadata.orientation.equals("landscape") ? 1 : metadata.orientation.equals("portrait") ? 2 : 0);
        form.addView(orientation);

        form.addView(Ui.label(this, "Categories"));
        categoryList = new LinearLayout(this);
        categoryList.setOrientation(LinearLayout.VERTICAL);
        categoryList.setBackground(Ui.background(Ui.PANEL, Color.rgb(53, 66, 105), 13, this));
        categoryList.setPadding(Ui.dp(this, 8), Ui.dp(this, 5), Ui.dp(this, 8), Ui.dp(this, 5));
        CatalogScanner scanner = new CatalogScanner(storage);
        try { scanner.scan(); } catch (RuntimeException ignored) {}
        for (String category : scanner.categories()) addCategoryCheck(category, metadata.categories.contains(category));
        for (String category : metadata.categories) if (!categoryChecks.containsKey(category)) addCategoryCheck(category, true);
        form.addView(categoryList);
        LinearLayout newCategory = Ui.row(this);
        EditText categoryName = Ui.input(this, "New category");
        Button addCategory = Ui.button(this, "Add");
        addCategory.setOnClickListener(v -> {
            String token = GameMetadata.normalizeToken(categoryName.getText().toString());
            if (token.isEmpty()) return;
            addCategoryCheck(token, true);
            categoryName.setText("");
        });
        newCategory.addView(categoryName, Ui.weight(1));
        newCategory.addView(Ui.text(this, " ", 1, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 6), 1));
        newCategory.addView(addCategory);
        form.addView(newCategory);

        form.addView(Ui.label(this, "Tags"));
        tags = Ui.input(this, "quick, touch, calm");
        tags.setText(join(metadata.tags));
        form.addView(tags);

        Button advancedToggle = Ui.button(this, "Advanced ▾");
        form.addView(advancedToggle);
        advanced = new LinearLayout(this);
        advanced.setOrientation(LinearLayout.VERTICAL);
        advanced.setVisibility(View.GONE);
        advanced.setPadding(Ui.dp(this, 2), 0, Ui.dp(this, 2), 0);
        advanced.addView(Ui.label(this, "Entry file"));
        entry = Ui.input(this, "index.html");
        entry.setText(metadata.entry);
        advanced.addView(entry);
        advanced.addView(Ui.label(this, "Icon file"));
        LinearLayout iconRow = Ui.row(this);
        icon = Ui.input(this, "icon.png");
        icon.setText(metadata.icon);
        Button chooseIcon = Ui.button(this, "Choose Image");
        chooseIcon.setOnClickListener(v -> chooseIcon());
        iconRow.addView(icon, Ui.weight(1));
        iconRow.addView(Ui.text(this, " ", 1, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 6), 1));
        iconRow.addView(chooseIcon);
        advanced.addView(iconRow);
        advanced.addView(Ui.label(this, "Display order"));
        order = Ui.input(this, "10");
        order.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_SIGNED);
        order.setText(String.valueOf(metadata.order));
        advanced.addView(order);
        form.addView(advanced);
        advancedToggle.setOnClickListener(v -> {
            boolean show = advanced.getVisibility() != View.VISIBLE;
            advanced.setVisibility(show ? View.VISIBLE : View.GONE);
            advancedToggle.setText(show ? "Advanced ▴" : "Advanced ▾");
        });

        scroll.addView(form, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private Spinner spinner(String[] values) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, values) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getView(position, convertView, parent);
                view.setTextColor(Ui.TEXT);
                view.setPadding(Ui.dp(MetadataActivity.this, 11), Ui.dp(MetadataActivity.this, 8), Ui.dp(MetadataActivity.this, 11), Ui.dp(MetadataActivity.this, 8));
                return view;
            }
            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getDropDownView(position, convertView, parent);
                view.setTextColor(Color.BLACK);
                view.setPadding(Ui.dp(MetadataActivity.this, 12), Ui.dp(MetadataActivity.this, 11), Ui.dp(MetadataActivity.this, 12), Ui.dp(MetadataActivity.this, 11));
                return view;
            }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setBackground(Ui.background(Ui.PANEL, Color.rgb(66, 80, 122), 11, this));
        return spinner;
    }

    private int capabilityIndex() {
        if (metadata.playersMin == 1 && metadata.playersMax == 1) return 0;
        if (metadata.playersMin == 2 && metadata.playersMax == 2) return 1;
        if (metadata.playersMin == 1 && metadata.playersMax == 2) return 2;
        return 3;
    }

    private void setRange(int min, int max) {
        playersMin.setText(String.valueOf(min));
        playersMax.setText(String.valueOf(max));
    }

    private void addCategoryCheck(String token, boolean checked) {
        if (categoryChecks.containsKey(token)) {
            if (checked) categoryChecks.get(token).setChecked(true);
            return;
        }
        CheckBox check = new CheckBox(this);
        check.setText(pretty(token));
        check.setTextColor(Ui.TEXT);
        check.setChecked(checked);
        categoryChecks.put(token, check);
        categoryList.addView(check, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 38)));
    }

    private String pretty(String token) {
        StringBuilder result = new StringBuilder();
        for (String part : token.replace('_', '-').split("-")) {
            if (part.isEmpty()) continue;
            if (result.length() > 0) result.append(' ');
            result.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return result.toString();
    }

    private String join(ArrayList<String> values) {
        StringBuilder result = new StringBuilder();
        for (String value : values) {
            if (result.length() > 0) result.append(", ");
            result.append(value);
        }
        return result.toString();
    }

    private int integer(EditText field, int fallback) {
        try { return Integer.parseInt(field.getText().toString().trim()); }
        catch (Exception error) { return fallback; }
    }

    private void save() {
        metadata.title = title.getText().toString().trim();
        metadata.enabled = enabled.isChecked();
        metadata.type = type.getSelectedItemPosition() == 1 ? "activity" : "game";
        metadata.playersMin = integer(playersMin, 1);
        metadata.playersMax = integer(playersMax, metadata.playersMin);
        metadata.orientation = orientation.getSelectedItemPosition() == 1 ? "landscape" : orientation.getSelectedItemPosition() == 2 ? "portrait" : "any";
        metadata.categories.clear();
        for (Map.Entry<String, CheckBox> item : categoryChecks.entrySet()) if (item.getValue().isChecked()) metadata.categories.add(item.getKey());
        metadata.tags.clear();
        for (String value : tags.getText().toString().split("[,\n]")) {
            String token = GameMetadata.normalizeToken(value);
            if (!token.isEmpty()) metadata.tags.add(token);
        }
        metadata.entry = entry.getText().toString().trim();
        metadata.icon = icon.getText().toString().trim();
        metadata.order = integer(order, 10);
        String error = metadata.validationError();
        if (error != null) {
            message(error);
            return;
        }
        try {
            if (metadataFile == null) metadataFile = storage.createFile(folder.uri, "game.json", "application/json");
            if (metadataFile == null) throw new IOException("Cannot create game.json.");
            storage.writeWithBackup(folder.uri, "game.json", metadataFile.uri, metadata.toJson());
            ArcadeStorage.markDirty(this);
            message("Metadata saved.");
            finish();
        } catch (Exception exception) {
            message("Save failed: " + exception.getMessage());
        }
    }

    private void chooseIcon() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        try {
            startActivityForResult(intent, PICK_ICON);
        } catch (RuntimeException error) {
            message("Android could not open the image picker.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_ICON || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri source = data.getData();
        String mime = getContentResolver().getType(source);
        String extension = mime == null ? "png" : mime.contains("jpeg") ? "jpg" : mime.contains("webp") ? "webp" : mime.contains("gif") ? "gif" : "png";
        String name = "icon." + extension;
        try (InputStream input = getContentResolver().openInputStream(source)) {
            if (input == null) throw new IOException("Image could not be opened.");
            ArcadeStorage.Doc target = storage.ensureFile(folder.uri, name, mime == null ? "image/png" : mime);
            if (target == null) throw new IOException("Icon file could not be created.");
            byte[] old = storage.readBytes(target.uri, 8 * 1024 * 1024);
            if (old.length > 0) {
                ArcadeStorage.Doc backups = storage.ensureDirectory(folder.uri, ArcadeStorage.BACKUP_FOLDER);
                ArcadeStorage.Doc backup = storage.ensureFile(backups.uri, name + ".previous", mime == null ? "application/octet-stream" : mime);
                storage.overwrite(backup.uri, new ByteArrayInputStream(old));
            }
            storage.overwrite(target.uri, input);
            icon.setText(name);
            ArcadeStorage.markDirty(this);
            message("Icon copied. Save metadata to use it.");
        } catch (Exception error) {
            message("Icon copy failed: " + error.getMessage());
        }
    }
}
