package com.familyarcade.platform;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.HorizontalScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.webkit.WebStorage;

import org.json.JSONException;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class LibraryActivity extends BaseActivity {
    private ArcadeStorage storage;
    private CatalogScanner scanner;
    private final ArrayList<CatalogScanner.Entry> all = new ArrayList<>();
    private final ArrayList<CatalogScanner.Entry> shown = new ArrayList<>();
    private final HashSet<String> selected = new HashSet<>();
    private ListView list;
    private EntryAdapter adapter;
    private Spinner filter;
    private EditText search;
    private TextView status;
    private ArrayAdapter<String> filterAdapter;
    private final ArrayList<String> filterValues = new ArrayList<>();
    private boolean suppressEnabledChange;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        storage = ArcadeStorage.fromPreferences(this);
        if (storage == null || !storage.hasPersistedAccess()) {
            startActivity(new Intent(this, MainActivity.class).putExtra("changeFolder", true));
            finish();
            return;
        }
        if (!storage.available()) {
            message("Android could not read the Arcade folder yet. Try again.");
            finish();
            return;
        }
        buildUi();
        rescan();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);
        root.setPadding(Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 7));

        LinearLayout top = Ui.row(this);
        Button back = Ui.button(this, "‹ Arcade");
        back.setOnClickListener(v -> finish());
        TextView title = Ui.title(this, "Manage Games");
        title.setPadding(Ui.dp(this, 10), 0, 0, 0);
        Button rescan = Ui.button(this, "↻");
        rescan.setOnClickListener(v -> rescan());
        Button folder = Ui.button(this, "Folder");
        folder.setOnClickListener(v -> changeFolder());
        Button data = Ui.button(this, "Data");
        data.setOnClickListener(v -> clearWebData());
        Button create = Ui.button(this, "+ New");
        create.setBackground(Ui.background(Color.rgb(16, 117, 146), Ui.CYAN, 12, this));
        create.setOnClickListener(v -> createNew());
        top.addView(back);
        top.addView(title, Ui.weight(1));
        top.addView(rescan);
        root.addView(top);

        LinearLayout headerActions = Ui.row(this);
        headerActions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        headerActions.addView(folder);
        headerActions.addView(Ui.text(this, " ", 2, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 5), 1));
        headerActions.addView(data);
        headerActions.addView(Ui.text(this, " ", 2, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 5), 1));
        headerActions.addView(create);
        root.addView(headerActions);

        LinearLayout tools = Ui.row(this);
        search = Ui.input(this, "Search");
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { applyFilter(); }
            @Override public void afterTextChanged(Editable s) {}
        });
        filter = new Spinner(this);
        filter.setBackground(Ui.background(Ui.PANEL, Color.rgb(74, 89, 132), 11, this));
        filter.setPadding(Ui.dp(this, 10), 0, Ui.dp(this, 8), 0);
        filter.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { applyFilter(); }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        Button alpha = Ui.button(this, "A-Z");
        alpha.setOnClickListener(v -> alphabetize());
        tools.addView(search, Ui.weight(1.2f));
        tools.addView(Ui.text(this, " ", 2, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 6), 1));
        tools.addView(filter, Ui.weight(1));
        tools.addView(Ui.text(this, " ", 2, Color.TRANSPARENT, false), new LinearLayout.LayoutParams(Ui.dp(this, 6), 1));
        tools.addView(alpha);
        root.addView(tools);

        status = Ui.text(this, "", 12, Ui.MUTED, true);
        status.setPadding(Ui.dp(this, 3), 0, 0, Ui.dp(this, 5));
        root.addView(status);

        list = new ListView(this);
        list.setDividerHeight(Ui.dp(this, 6));
        list.setDivider(null);
        list.setCacheColorHint(Color.TRANSPARENT);
        adapter = new EntryAdapter();
        list.setAdapter(adapter);
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        HorizontalScrollView bulkScroll = new HorizontalScrollView(this);
        bulkScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout bulk = new LinearLayout(this);
        bulk.setOrientation(LinearLayout.HORIZONTAL);
        bulk.setGravity(Gravity.CENTER_VERTICAL);
        bulk.setPadding(0, Ui.dp(this, 6), 0, 0);
        String[] labels = {"Enable", "Disable", "Game", "Activity", "+ Category", "- Category", "Clear selection"};
        for (String label : labels) {
            Button action = Ui.button(this, label);
            action.setOnClickListener(v -> bulkAction(label));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 40));
            params.setMargins(0, 0, Ui.dp(this, 6), 0);
            bulk.addView(action, params);
        }
        bulkScroll.addView(bulk, new HorizontalScrollView.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(bulkScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 48)));
        setContentView(root);
    }

    private void rescan() {
        storage.invalidateCache();
        CatalogScanner refreshed = new CatalogScanner(storage);
        List<CatalogScanner.Entry> scanned;
        try {
            scanned = refreshed.scan();
        } catch (RuntimeException error) {
            message("Android could not refresh the Arcade folder. Try again.");
            return;
        }
        scanner = refreshed;
        all.clear();
        all.addAll(scanned);
        selected.retainAll(folderIds(all));
        int oldPosition = filter.getSelectedItemPosition();
        filterValues.clear();
        Collections.addAll(filterValues, "All", "Games", "Activities", "Single Player", "Two Player", "Disabled", "Missing Metadata");
        for (String category : scanner.categories()) filterValues.add("Category: " + pretty(category));
        filterAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, filterValues) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getView(position, convertView, parent);
                view.setTextColor(Ui.TEXT);
                view.setTextSize(13);
                return view;
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getDropDownView(position, convertView, parent);
                view.setTextColor(Color.BLACK);
                view.setTextSize(14);
                view.setPadding(Ui.dp(LibraryActivity.this, 12), Ui.dp(LibraryActivity.this, 11), Ui.dp(LibraryActivity.this, 12), Ui.dp(LibraryActivity.this, 11));
                return view;
            }
        };
        filterAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        filter.setAdapter(filterAdapter);
        filter.setSelection(Math.min(Math.max(0, oldPosition), filterValues.size() - 1));
        applyFilter();
    }

    private Set<String> folderIds(List<CatalogScanner.Entry> list) {
        HashSet<String> ids = new HashSet<>();
        for (CatalogScanner.Entry entry : list) ids.add(entry.folder.uri.toString());
        return ids;
    }

    private void applyFilter() {
        if (filter == null || filter.getAdapter() == null) return;
        shown.clear();
        String query = search.getText().toString().trim().toLowerCase(Locale.US);
        String value = filter.getSelectedItem() == null ? "All" : filter.getSelectedItem().toString();
        for (CatalogScanner.Entry entry : all) {
            GameMetadata metadata = entry.metadata;
            boolean match = query.isEmpty() || metadata.title.toLowerCase(Locale.US).contains(query) || entry.folder.name.toLowerCase(Locale.US).contains(query) || metadata.tags.toString().contains(query) || metadata.categories.toString().contains(query);
            if (!match) continue;
            if (value.equals("Games") && !metadata.type.equals("game")) continue;
            if (value.equals("Activities") && !metadata.type.equals("activity")) continue;
            if (value.equals("Single Player") && !(metadata.playersMin <= 1 && metadata.playersMax >= 1)) continue;
            if (value.equals("Two Player") && metadata.playersMax < 2) continue;
            if (value.equals("Disabled") && metadata.enabled) continue;
            if (value.equals("Missing Metadata") && !entry.missingMetadata() && entry.warning == null) continue;
            if (value.startsWith("Category: ")) {
                String wanted = GameMetadata.normalizeToken(value.substring(10));
                if (!metadata.categories.contains(wanted)) continue;
            }
            shown.add(entry);
        }
        status.setText(shown.size() + " shown • " + selected.size() + " selected" + (canDrag() ? " • Drag ↕ to reorder" : ""));
        adapter.notifyDataSetChanged();
    }

    private boolean canDrag() {
        String value = filter.getSelectedItem() == null ? "All" : filter.getSelectedItem().toString();
        return value.equals("All") && search.getText().toString().trim().isEmpty();
    }

    private String pretty(String token) {
        StringBuilder value = new StringBuilder();
        for (String part : token.replace('_', '-').split("-")) {
            if (part.isEmpty()) continue;
            if (value.length() > 0) value.append(' ');
            value.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return value.toString();
    }

    private void openMetadata(CatalogScanner.Entry entry) {
        Intent intent = new Intent(this, MetadataActivity.class);
        intent.putExtra("folderUri", entry.folder.uri.toString());
        startActivity(intent);
    }

    private void openFiles(CatalogScanner.Entry entry) {
        Intent intent = new Intent(this, FileBrowserActivity.class);
        intent.putExtra("folderUri", entry.folder.uri.toString());
        intent.putExtra("folderName", entry.folder.name);
        intent.putExtra("entry", entry.metadata.entry);
        startActivity(intent);
    }

    private boolean saveMetadata(CatalogScanner.Entry entry) {
        try {
            String error = entry.metadata.validationError();
            if (error != null) throw new IOException(error);
            if (entry.metadataFile == null) entry.metadataFile = storage.createFile(entry.folder.uri, "game.json", "application/json");
            if (entry.metadataFile == null) throw new IOException("Cannot create game.json.");
            storage.writeWithBackup(entry.folder.uri, "game.json", entry.metadataFile.uri, entry.metadata.toJson());
            ArcadeStorage.markDirty(this);
            return true;
        } catch (Exception error) {
            message("Save failed: " + error.getMessage());
            return false;
        }
    }

    private void persistOrders() {
        for (int i = 0; i < all.size(); i++) {
            CatalogScanner.Entry entry = all.get(i);
            entry.metadata.order = (i + 1) * 10;
            saveMetadata(entry);
        }
        rescan();
    }

    private void alphabetize() {
        new AlertDialog.Builder(this)
            .setTitle("Alphabetize all items?")
            .setMessage("This rewrites their display order.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Alphabetize", (dialog, which) -> {
                Collections.sort(all, (a, b) -> a.metadata.title.compareToIgnoreCase(b.metadata.title));
                persistOrders();
            })
            .show();
    }

    private void moveEntry(CatalogScanner.Entry entry, boolean top) {
        all.remove(entry);
        if (top) all.add(0, entry); else all.add(entry);
        persistOrders();
    }

    private void bulkAction(String action) {
        if (action.equals("Clear selection")) {
            selected.clear();
            applyFilter();
            return;
        }
        ArrayList<CatalogScanner.Entry> targets = new ArrayList<>();
        for (CatalogScanner.Entry entry : all) if (selected.contains(entry.folder.uri.toString())) targets.add(entry);
        if (targets.isEmpty()) {
            message("Select one or more items first.");
            return;
        }
        if (action.equals("+ Category") || action.equals("- Category")) {
            categoryBulk(targets, action.startsWith("+"));
            return;
        }
        for (CatalogScanner.Entry entry : targets) {
            if (action.equals("Enable")) entry.metadata.enabled = true;
            if (action.equals("Disable")) entry.metadata.enabled = false;
            if (action.equals("Game")) entry.metadata.type = "game";
            if (action.equals("Activity")) entry.metadata.type = "activity";
            saveMetadata(entry);
        }
        rescan();
    }

    private void categoryBulk(ArrayList<CatalogScanner.Entry> targets, boolean add) {
        ArrayList<String> values = new ArrayList<>(scanner.categories());
        if (add) values.add("Create new category…");
        if (values.isEmpty()) {
            if (add) newCategory(targets); else message("No categories are assigned.");
            return;
        }
        String[] labels = new String[values.size()];
        for (int i = 0; i < values.size(); i++) labels[i] = values.get(i).startsWith("Create ") ? values.get(i) : pretty(values.get(i));
        new AlertDialog.Builder(this)
            .setTitle(add ? "Add category" : "Remove category")
            .setItems(labels, (dialog, which) -> {
                String chosen = values.get(which);
                if (chosen.startsWith("Create ")) {
                    newCategory(targets);
                    return;
                }
                for (CatalogScanner.Entry entry : targets) {
                    if (add && !entry.metadata.categories.contains(chosen)) entry.metadata.categories.add(chosen);
                    if (!add) entry.metadata.categories.remove(chosen);
                    saveMetadata(entry);
                }
                rescan();
            })
            .show();
    }

    private void newCategory(ArrayList<CatalogScanner.Entry> targets) {
        EditText input = Ui.input(this, "Category name");
        input.setSingleLine(true);
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(Ui.dp(this, 20), Ui.dp(this, 4), Ui.dp(this, 20), 0);
        wrap.addView(input);
        new AlertDialog.Builder(this)
            .setTitle("New category")
            .setView(wrap)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Add", (dialog, which) -> {
                String token = GameMetadata.normalizeToken(input.getText().toString());
                if (token.isEmpty()) return;
                for (CatalogScanner.Entry entry : targets) {
                    if (!entry.metadata.categories.contains(token)) entry.metadata.categories.add(token);
                    saveMetadata(entry);
                }
                rescan();
            })
            .show();
    }

    private void createNew() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(Ui.dp(this, 20), Ui.dp(this, 4), Ui.dp(this, 20), 0);
        EditText title = Ui.input(this, "Title");
        Spinner type = new Spinner(this);
        ArrayAdapter<String> types = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"Game", "Activity"});
        type.setAdapter(types);
        form.addView(title);
        form.addView(type);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("New content")
            .setView(form)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Create", null)
            .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(DialogInterface.BUTTON_POSITIVE).setOnClickListener(v -> {
            String name = title.getText().toString().trim();
            if (name.isEmpty()) {
                title.setError("Title is required");
                return;
            }
            try {
                createNewFiles(name, type.getSelectedItemPosition() == 1 ? "activity" : "game");
                dialog.dismiss();
            } catch (Exception error) {
                message("Could not create item: " + error.getMessage());
            }
        }));
        dialog.show();
    }

    private void createNewFiles(String title, String type) throws Exception {
        String base = GameMetadata.normalizeToken(title);
        if (base.isEmpty()) base = "new-item";
        String slug = base;
        int number = 2;
        while (storage.childRequired(storage.getRootUri(), slug) != null) slug = base + "-" + number++;
        ArcadeStorage.Doc folder = storage.createDirectory(storage.getRootUri(), slug);
        if (folder == null) throw new IOException("Folder creation failed.");
        ArcadeStorage.Doc page = storage.createFile(folder.uri, "index.html", "text/html");
        ArcadeStorage.Doc json = storage.createFile(folder.uri, "game.json", "application/json");
        if (page == null || json == null) throw new IOException("File creation failed.");
        GameMetadata metadata = GameMetadata.inferred(slug, "index.html", (all.size() + 1) * 10);
        metadata.title = title;
        metadata.type = type;
        metadata.icon = "";
        String safeTitle = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
        String html = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<title>" + safeTitle + "</title>\n<style>html,body{margin:0;height:100%;font-family:system-ui;background:#090d1e;color:#fff}main{height:100%;display:grid;place-items:center;text-align:center}a{color:#21dcff}</style>\n</head>\n<body>\n<main><div><h1>" + safeTitle + "</h1><p>Edit this page in Manage Games.</p><a href=\"../index.html\">Back to Arcade</a></div></main>\n</body>\n</html>\n";
        storage.overwriteText(page.uri, html);
        storage.overwriteText(json.uri, metadata.toJson());
        ArcadeStorage.markDirty(this);
        Intent editor = new Intent(this, EditorActivity.class);
        editor.putExtra("fileUri", page.uri.toString());
        editor.putExtra("gameFolderUri", folder.uri.toString());
        editor.putExtra("relativeName", "index.html");
        editor.putExtra("previewPath", slug + "/index.html");
        startActivity(editor);
        rescan();
    }

    private void changeFolder() {
        startActivity(new Intent(this, MainActivity.class).putExtra("changeFolder", true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }

    private void clearWebData() {
        new AlertDialog.Builder(this)
            .setTitle("Clear Arcade web data?")
            .setMessage("This removes saved games, high scores, and browser storage for every arcade item. Source files and metadata are not changed.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Clear Web Data", (dialog, which) -> {
                WebStorage.getInstance().deleteAllData();
                ArcadeStorage.markDirty(this);
                message("Arcade web data cleared.");
            })
            .show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (storage != null && list != null) rescan();
    }

    private final class EntryAdapter extends BaseAdapter {
        @Override public int getCount() { return shown.size(); }
        @Override public CatalogScanner.Entry getItem(int position) { return shown.get(position); }
        @Override public long getItemId(int position) { return getItem(position).folder.uri.toString().hashCode(); }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            CatalogScanner.Entry entry = getItem(position);
            LinearLayout card = new LinearLayout(LibraryActivity.this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setBackground(Ui.background(Ui.PANEL, entry.warning == null ? Color.rgb(52, 65, 104) : Ui.RED, 14, LibraryActivity.this));
            card.setPadding(Ui.dp(LibraryActivity.this, 7), Ui.dp(LibraryActivity.this, 5), Ui.dp(LibraryActivity.this, 6), Ui.dp(LibraryActivity.this, 5));
            LinearLayout row = new LinearLayout(LibraryActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            card.setOnLongClickListener(v -> {
                new AlertDialog.Builder(LibraryActivity.this)
                    .setTitle(entry.metadata.title)
                    .setItems(new String[]{"Move to Top", "Move to Bottom", "Delete Game Folder"}, (dialog, which) -> {
                        if (which < 2) moveEntry(entry, which == 0);
                        else confirmDeleteGame(entry);
                    })
                    .show();
                return true;
            });

            CheckBox select = new CheckBox(LibraryActivity.this);
            select.setChecked(selected.contains(entry.folder.uri.toString()));
            select.setOnCheckedChangeListener((button, checked) -> {
                if (checked) selected.add(entry.folder.uri.toString()); else selected.remove(entry.folder.uri.toString());
                status.setText(shown.size() + " shown • " + selected.size() + " selected" + (canDrag() ? " • Drag ↕ to reorder" : ""));
            });
            row.addView(select, new LinearLayout.LayoutParams(Ui.dp(LibraryActivity.this, 42), Ui.dp(LibraryActivity.this, 48)));

            ImageView icon = new ImageView(LibraryActivity.this);
            icon.setScaleType(ImageView.ScaleType.CENTER_CROP);
            icon.setBackground(Ui.background(Color.rgb(35, 45, 77), Color.rgb(82, 98, 143), 11, LibraryActivity.this));
            loadIcon(entry, icon);
            LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(Ui.dp(LibraryActivity.this, 48), Ui.dp(LibraryActivity.this, 48));
            iconParams.setMargins(0, 0, Ui.dp(LibraryActivity.this, 9), 0);
            row.addView(icon, iconParams);

            LinearLayout copy = new LinearLayout(LibraryActivity.this);
            copy.setOrientation(LinearLayout.VERTICAL);
            TextView title = Ui.text(LibraryActivity.this, entry.metadata.title, 16, Ui.TEXT, true);
            String range = entry.metadata.playersMin == entry.metadata.playersMax ? entry.metadata.playersMax + " player" : entry.metadata.playersMin + "-" + entry.metadata.playersMax + " players";
            TextView detail = Ui.text(LibraryActivity.this, pretty(entry.metadata.type) + " • " + range, 11, Ui.MUTED, false);
            copy.addView(title);
            copy.addView(detail);
            if (entry.warning != null) copy.addView(Ui.text(LibraryActivity.this, "⚠ " + entry.warning, 11, Ui.RED, true));
            copy.setOnClickListener(v -> openMetadata(entry));
            row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

            CheckBox enabled = new CheckBox(LibraryActivity.this);
            enabled.setText("On");
            enabled.setTextColor(Ui.MUTED);
            enabled.setTextSize(11);
            enabled.setChecked(entry.metadata.enabled);
            enabled.setEnabled(!entry.missingMetadata());
            enabled.setOnCheckedChangeListener((button, checked) -> {
                if (suppressEnabledChange) return;
                entry.metadata.enabled = checked;
                saveMetadata(entry);
            });
            row.addView(enabled, new LinearLayout.LayoutParams(Ui.dp(LibraryActivity.this, 62), Ui.dp(LibraryActivity.this, 48)));

            TextView drag = Ui.text(LibraryActivity.this, "↕", 25, canDrag() ? Ui.CYAN : Color.rgb(70, 80, 111), true);
            drag.setGravity(Gravity.CENTER);
            drag.setOnTouchListener(new DragListener(entry));
            row.addView(drag, new LinearLayout.LayoutParams(Ui.dp(LibraryActivity.this, 42), Ui.dp(LibraryActivity.this, 48)));
            card.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            LinearLayout actions = Ui.row(LibraryActivity.this);
            actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
            Button files = Ui.button(LibraryActivity.this, "Files");
            files.setOnClickListener(v -> openFiles(entry));
            actions.addView(files, new LinearLayout.LayoutParams(Ui.dp(LibraryActivity.this, 82), Ui.dp(LibraryActivity.this, 38)));
            Button edit = Ui.button(LibraryActivity.this, "Metadata");
            edit.setOnClickListener(v -> openMetadata(entry));
            LinearLayout.LayoutParams editParams = new LinearLayout.LayoutParams(Ui.dp(LibraryActivity.this, 106), Ui.dp(LibraryActivity.this, 38));
            editParams.setMargins(Ui.dp(LibraryActivity.this, 6), 0, 0, 0);
            actions.addView(edit, editParams);
            card.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(LibraryActivity.this, 40)));
            return card;
        }

        private void loadIcon(CatalogScanner.Entry entry, ImageView icon) {
            if (entry.metadata.icon.isEmpty()) return;
            ArcadeStorage.Doc file = storage.resolve(entry.folder.name + "/" + entry.metadata.icon);
            if (file == null) return;
            try {
                byte[] bytes = storage.readBytes(file.uri, 2 * 1024 * 1024);
                Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap != null) icon.setImageBitmap(bitmap);
            } catch (Exception ignored) {}
        }
    }

    private void confirmDeleteGame(CatalogScanner.Entry entry) {
        new AlertDialog.Builder(this)
            .setTitle("Delete " + entry.metadata.title + "?")
            .setMessage("This permanently deletes the game folder and every file inside it. Disable the item instead if you may want it later.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete Permanently", (dialog, which) -> {
                if (storage.delete(entry.folder.uri)) {
                    selected.remove(entry.folder.uri.toString());
                    ArcadeStorage.markDirty(this);
                    rescan();
                } else {
                    message("Android could not delete that folder.");
                }
            })
            .show();
    }

    private final class DragListener implements View.OnTouchListener {
        private final CatalogScanner.Entry dragged;
        private int current;

        DragListener(CatalogScanner.Entry dragged) {
            this.dragged = dragged;
        }

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            if (!canDrag()) return false;
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                current = all.indexOf(dragged);
                view.getParent().requestDisallowInterceptTouchEvent(true);
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                int[] location = new int[2];
                list.getLocationOnScreen(location);
                int position = list.pointToPosition(1, (int) event.getRawY() - location[1]);
                if (position >= 0 && position < all.size() && position != current) {
                    Collections.swap(all, current, position);
                    shown.clear();
                    shown.addAll(all);
                    current = position;
                    adapter.notifyDataSetChanged();
                }
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                view.getParent().requestDisallowInterceptTouchEvent(false);
                persistOrders();
                return true;
            }
            return true;
        }
    }
}
