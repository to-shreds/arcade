package com.familyarcade.platform;

import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class CatalogScanner {
    public static final class Entry {
        public final ArcadeStorage.Doc folder;
        public ArcadeStorage.Doc metadataFile;
        public GameMetadata metadata;
        public String warning;

        Entry(ArcadeStorage.Doc folder) {
            this.folder = folder;
        }

        public String launchPath() {
            return folder.name + "/" + metadata.entry;
        }

        public boolean missingMetadata() {
            return metadataFile == null;
        }
    }

    private final ArcadeStorage storage;
    private final ArrayList<Entry> entries = new ArrayList<>();
    private final LinkedHashSet<String> categories = new LinkedHashSet<>();

    public CatalogScanner(ArcadeStorage storage) {
        this.storage = storage;
    }

    public List<Entry> scan() {
        entries.clear();
        categories.clear();
        int largestOrder = 0;
        ArrayList<Entry> pending = new ArrayList<>();
        for (ArcadeStorage.Doc folder : storage.listRequired(storage.getRootUri())) {
            if (!folder.isDirectory() || folder.name.equals(ArcadeStorage.BACKUP_FOLDER)) continue;
            ArcadeStorage.Doc json = storage.childRequired(folder.uri, "game.json");
            ArcadeStorage.Doc likely = likelyEntry(folder.uri);
            if (json == null && likely == null) continue;
            Entry entry = new Entry(folder);
            entry.metadataFile = json;
            if (json == null) {
                entry.warning = "Metadata needed";
                entry.metadata = GameMetadata.inferred(folder.name, likely == null ? "index.html" : likely.name, 0);
                pending.add(entry);
            } else {
                try {
                    String metadataText = storage.readText(json.uri);
                    entry.metadata = GameMetadata.fromJson(metadataText);
                    String validation = entry.metadata.validationError();
                    if (validation != null) entry.warning = validation;
                } catch (JSONException error) {
                    entry.warning = "Malformed game.json";
                    entry.metadata = GameMetadata.inferred(folder.name, likely == null ? "index.html" : likely.name, 0);
                } catch (IOException error) {
                    throw new ArcadeStorage.StorageQueryException("Android could not read game.json.", error);
                }
                largestOrder = Math.max(largestOrder, entry.metadata.order);
                inspectFiles(entry);
                entries.add(entry);
            }
        }
        for (Entry entry : pending) {
            largestOrder += 10;
            entry.metadata.order = largestOrder;
            entries.add(entry);
        }
        Collections.sort(entries, new Comparator<Entry>() {
            @Override
            public int compare(Entry left, Entry right) {
                int byOrder = Integer.compare(left.metadata.order, right.metadata.order);
                return byOrder != 0 ? byOrder : left.metadata.title.compareToIgnoreCase(right.metadata.title);
            }
        });
        for (Entry entry : entries) categories.addAll(entry.metadata.categories);
        return entries;
    }

    private ArcadeStorage.Doc likelyEntry(Uri folder) {
        ArcadeStorage.Doc index = storage.childRequired(folder, "index.html");
        if (index != null && !index.isDirectory()) return index;
        for (ArcadeStorage.Doc child : storage.listRequired(folder)) {
            String lower = child.name.toLowerCase();
            if (!child.isDirectory() && (lower.endsWith(".html") || lower.endsWith(".htm"))) return child;
        }
        return null;
    }

    private ArcadeStorage.Doc resolveInside(Uri folder, String path) {
        Uri current = folder;
        ArcadeStorage.Doc result = null;
        for (String part : path.replace('\\', '/').split("/")) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return null;
            result = storage.childRequired(current, part);
            if (result == null) return null;
            current = result.uri;
        }
        return result;
    }

    private void inspectFiles(Entry entry) {
        if (entry.metadata == null) return;
        ArcadeStorage.Doc launch = resolveInside(entry.folder.uri, entry.metadata.entry);
        if (launch == null || launch.isDirectory()) entry.warning = combine(entry.warning, "Missing entry file");
        if (!entry.metadata.icon.isEmpty()) {
            ArcadeStorage.Doc icon = resolveInside(entry.folder.uri, entry.metadata.icon);
            if (icon == null || icon.isDirectory()) entry.warning = combine(entry.warning, "Missing icon");
        }
    }

    private String combine(String current, String next) {
        return current == null || current.isEmpty() ? next : current + "; " + next;
    }

    public List<Entry> entries() {
        return entries;
    }

    public Set<String> categories() {
        return categories;
    }

    public Entry byLaunchPath(String path) {
        if (path == null) return null;
        String clean = path.startsWith("/") ? path.substring(1) : path;
        for (Entry entry : entries) if (entry.launchPath().equals(clean)) return entry;
        return null;
    }

    public Entry byFolderUri(String value) {
        if (value == null) return null;
        for (Entry entry : entries) if (entry.folder.uri.toString().equals(value)) return entry;
        return null;
    }

    public String toCatalogJson() throws JSONException {
        JSONObject root = new JSONObject();
        root.put("version", 1);
        JSONArray list = new JSONArray();
        for (Entry entry : entries) {
            GameMetadata metadata = entry.metadata;
            JSONObject item = new JSONObject(metadata.toJson());
            item.put("folder", entry.folder.name);
            item.put("launchPath", entry.launchPath());
            item.put("warning", entry.warning == null ? JSONObject.NULL : entry.warning);
            item.put("missingMetadata", entry.missingMetadata());
            list.put(item);
        }
        root.put("items", list);
        root.put("categories", new JSONArray(categories));
        return root.toString(2);
    }
}
