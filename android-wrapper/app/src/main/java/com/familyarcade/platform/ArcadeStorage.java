package com.familyarcade.platform;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.webkit.MimeTypeMap;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class ArcadeStorage {
    public static final String PREFS = "arcade_platform";
    public static final String PREF_TREE = "arcade_tree_uri";
    public static final String PREF_DIRTY = "catalog_dirty";
    public static final String BACKUP_FOLDER = "__backups__";
    public static final String DIRECTORY_MIME = DocumentsContract.Document.MIME_TYPE_DIR;

    private final Context context;
    private final ContentResolver resolver;
    private final Uri treeUri;
    private final Uri rootUri;
    private final Object cacheLock = new Object();
    private final Map<String, List<Doc>> directoryCache = new HashMap<>();
    private long cacheGeneration;

    public static final class StorageQueryException extends RuntimeException {
        StorageQueryException(String message) {
            super(message);
        }

        StorageQueryException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static final class Doc {
        public final Uri uri;
        public final String documentId;
        public final String name;
        public final String mime;
        public final long size;
        public final long modified;
        public final long flags;

        Doc(Uri uri, String documentId, String name, String mime, long size, long modified, long flags) {
            this.uri = uri;
            this.documentId = documentId;
            this.name = name == null ? "" : name;
            this.mime = mime == null ? "application/octet-stream" : mime;
            this.size = size;
            this.modified = modified;
            this.flags = flags;
        }

        public boolean isDirectory() {
            return DIRECTORY_MIME.equals(mime);
        }
    }

    public ArcadeStorage(Context context, Uri treeUri) {
        this.context = context.getApplicationContext();
        this.resolver = context.getContentResolver();
        this.treeUri = treeUri;
        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
        this.rootUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId);
    }

    public static ArcadeStorage fromPreferences(Context context) {
        String value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_TREE, null);
        if (value == null || value.isEmpty()) return null;
        try {
            Uri uri = Uri.parse(value);
            if (!hasPersistedReadPermission(context, uri)) return null;
            return new ArcadeStorage(context, uri);
        } catch (Exception error) {
            return null;
        }
    }

    public static void rememberTree(Context context, Uri uri) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PREF_TREE, uri.toString())
            .putBoolean(PREF_DIRTY, false)
            .commit();
    }

    public static void clearRememberedTree(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(PREF_TREE)
            .putBoolean(PREF_DIRTY, false)
            .commit();
    }

    public static boolean hasPersistedReadPermission(Context context, Uri uri) {
        if (uri == null) return false;
        try {
            for (UriPermission permission : context.getContentResolver().getPersistedUriPermissions()) {
                if (uri.equals(permission.getUri()) && permission.isReadPermission()) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    public static void markDirty(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_DIRTY, true).apply();
    }

    public static boolean takeDirty(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean dirty = preferences.getBoolean(PREF_DIRTY, false);
        if (dirty) preferences.edit().putBoolean(PREF_DIRTY, false).apply();
        return dirty;
    }

    public Uri getTreeUri() {
        return treeUri;
    }

    public Uri getRootUri() {
        return rootUri;
    }

    public boolean hasPersistedAccess() {
        return hasPersistedReadPermission(context, treeUri);
    }

    public boolean available() {
        try {
            if (!hasPersistedAccess()) return false;
            Doc root = queryDoc(rootUri);
            return root != null && root.isDirectory();
        } catch (Exception error) {
            return false;
        }
    }

    public void invalidateCache() {
        synchronized (cacheLock) {
            cacheGeneration++;
            directoryCache.clear();
        }
    }

    public Doc queryDoc(Uri uri) {
        Doc result = queryDocOnce(uri);
        return result == null ? queryDocOnce(uri) : result;
    }

    private Doc queryDocOnce(Uri uri) {
        String[] projection = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_FLAGS
        };
        try (Cursor cursor = resolver.query(uri, projection, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            return docFromCursor(cursor, uri);
        } catch (Exception error) {
            return null;
        }
    }

    private Doc docFromCursor(Cursor cursor, Uri knownUri) {
        String id = cursor.getString(0);
        String name = cursor.getString(1);
        String mime = cursor.getString(2);
        long size = cursor.isNull(3) ? 0 : cursor.getLong(3);
        long modified = cursor.isNull(4) ? 0 : cursor.getLong(4);
        long flags = cursor.isNull(5) ? 0 : cursor.getLong(5);
        Uri uri = knownUri == null ? DocumentsContract.buildDocumentUriUsingTree(treeUri, id) : knownUri;
        return new Doc(uri, id, name, mime, size, modified, flags);
    }

    public List<Doc> list(Uri parentUri) {
        try {
            return listRequired(parentUri);
        } catch (StorageQueryException error) {
            return new ArrayList<>();
        }
    }

    public List<Doc> listRequired(Uri parentUri) {
        if (parentUri == null) throw new StorageQueryException("Folder URI is unavailable.");
        String cacheKey = parentUri.toString();
        long generation;
        synchronized (cacheLock) {
            List<Doc> cached = directoryCache.get(cacheKey);
            if (cached != null) return new ArrayList<>(cached);
            generation = cacheGeneration;
        }
        String parentId;
        try {
            parentId = DocumentsContract.getDocumentId(parentUri);
        } catch (Exception error) {
            throw new StorageQueryException("Folder URI is invalid.", error);
        }
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] projection = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_FLAGS
        };
        ArrayList<Doc> result = queryChildren(children, projection);
        if (result == null) result = queryChildren(children, projection);
        if (result == null) throw new StorageQueryException("Android could not read the selected folder.");
        Collections.sort(result, new Comparator<Doc>() {
            @Override
            public int compare(Doc left, Doc right) {
                if (left.isDirectory() != right.isDirectory()) return left.isDirectory() ? -1 : 1;
                return left.name.compareToIgnoreCase(right.name);
            }
        });
        synchronized (cacheLock) {
            if (cacheGeneration == generation) directoryCache.put(cacheKey, new ArrayList<>(result));
        }
        return result;
    }

    private ArrayList<Doc> queryChildren(Uri children, String[] projection) {
        ArrayList<Doc> result = new ArrayList<>();
        try (Cursor cursor = resolver.query(children, projection, null, null, null)) {
            if (cursor == null) return null;
            while (cursor.moveToNext()) result.add(docFromCursor(cursor, null));
            return result;
        } catch (Exception error) {
            return null;
        }
    }

    public Doc child(Uri parentUri, String name) {
        try {
            return childRequired(parentUri, name);
        } catch (StorageQueryException error) {
            return null;
        }
    }

    public Doc childRequired(Uri parentUri, String name) {
        Doc fallback = null;
        for (Doc doc : listRequired(parentUri)) {
            if (doc.name.equals(name)) return doc;
            if (fallback == null && doc.name.equalsIgnoreCase(name)) fallback = doc;
        }
        return fallback;
    }

    public Doc resolve(String relativePath) {
        try {
            return resolveRequired(relativePath);
        } catch (StorageQueryException error) {
            return null;
        }
    }

    public Doc resolveRequired(String relativePath) {
        if (relativePath == null) return null;
        String clean = relativePath.replace('\\', '/');
        while (clean.startsWith("/")) clean = clean.substring(1);
        if (clean.isEmpty()) return queryDoc(rootUri);
        Uri current = rootUri;
        Doc found = null;
        for (String part : clean.split("/")) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return null;
            found = childRequired(current, Uri.decode(part));
            if (found == null) return null;
            current = found.uri;
        }
        return found;
    }

    public InputStream open(Uri uri) throws FileNotFoundException {
        return resolver.openInputStream(uri);
    }

    public String readText(Uri uri) throws IOException {
        try (InputStream input = open(uri)) {
            if (input == null) throw new FileNotFoundException(uri.toString());
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 8 * 1024 * 1024) throw new IOException("File is larger than 8 MB.");
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public byte[] readBytes(Uri uri, int limit) throws IOException {
        try (InputStream input = open(uri)) {
            if (input == null) throw new FileNotFoundException(uri.toString());
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (limit > 0 && total > limit) throw new IOException("File is too large.");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    public void overwrite(Uri uri, InputStream input) throws IOException {
        try (OutputStream output = resolver.openOutputStream(uri, "rwt")) {
            if (output == null) throw new IOException("Cannot write file.");
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
        invalidateCache();
    }

    public void overwriteText(Uri uri, String text) throws IOException {
        overwrite(uri, new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    public Doc createFile(Uri parent, String name, String mime) throws FileNotFoundException {
        Uri uri = DocumentsContract.createDocument(resolver, parent, mime == null ? mimeForName(name) : mime, name);
        invalidateCache();
        return uri == null ? null : queryDoc(uri);
    }

    public Doc createDirectory(Uri parent, String name) throws FileNotFoundException {
        Uri uri = DocumentsContract.createDocument(resolver, parent, DIRECTORY_MIME, name);
        invalidateCache();
        return uri == null ? null : queryDoc(uri);
    }

    public Doc ensureDirectory(Uri parent, String name) throws FileNotFoundException {
        Doc found = childRequired(parent, name);
        if (found != null && found.isDirectory()) return found;
        return createDirectory(parent, name);
    }

    public Doc ensureFile(Uri parent, String name, String mime) throws FileNotFoundException {
        Doc found = childRequired(parent, name);
        if (found != null && !found.isDirectory()) return found;
        return createFile(parent, name, mime);
    }

    public void writeWithBackup(Uri gameFolder, String relativeName, Uri target, String text) throws IOException {
        String old = readText(target);
        if (old.equals(text)) return;
        Doc backups = ensureDirectory(gameFolder, BACKUP_FOLDER);
        if (backups == null) throw new IOException("Cannot create backup folder.");
        String backupName = relativeName.replace('\\', '/').replace("/", "__").replaceAll("[^A-Za-z0-9._-]", "_") + ".previous";
        Doc backup = ensureFile(backups.uri, backupName, "text/plain");
        if (backup == null) throw new IOException("Cannot create backup.");
        overwriteText(backup.uri, old);
        overwriteText(target, text);
    }

    public String readBackup(Uri gameFolder, String relativeName) throws IOException {
        Doc backups = child(gameFolder, BACKUP_FOLDER);
        if (backups == null || !backups.isDirectory()) return null;
        String backupName = relativeName.replace('\\', '/').replace("/", "__").replaceAll("[^A-Za-z0-9._-]", "_") + ".previous";
        Doc backup = child(backups.uri, backupName);
        return backup == null ? null : readText(backup.uri);
    }

    public boolean delete(Uri uri) {
        try {
            boolean deleted = DocumentsContract.deleteDocument(resolver, uri);
            if (deleted) invalidateCache();
            return deleted;
        } catch (Exception error) {
            return false;
        }
    }

    public static boolean editable(String name) {
        String lower = name.toLowerCase(Locale.US);
        return lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".css") || lower.endsWith(".js") || lower.endsWith(".json") || lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".xml") || lower.endsWith(".csv") || lower.endsWith(".svg");
    }

    public static String mimeForName(String name) {
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".webm")) return "audio/webm";
        String extension = MimeTypeMap.getFileExtensionFromUrl(name);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension == null ? "" : extension.toLowerCase(Locale.US));
        return mime == null ? "application/octet-stream" : mime;
    }
}
