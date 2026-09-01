package com.familyarcade.platform;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

final class OfflineArchiveManager {
    static final String REMOTE_HOST = "to-shreds.github.io";
    static final String REMOTE_PATH = "/arcade/";
    static final String REMOTE_BASE = "https://" + REMOTE_HOST + REMOTE_PATH;
    private static final String MANIFEST_NAME = "offline-manifest.json";
    private static final String STORED_MANIFEST_NAME = ".offline-manifest.json";
    private static final int CONNECT_TIMEOUT_MS = 4500;
    private static final int MANIFEST_READ_TIMEOUT_MS = 6500;
    private static final int FILE_READ_TIMEOUT_MS = 12000;
    private static final long MAX_MANIFEST_BYTES = 2L * 1024L * 1024L;
    private static final long MAX_FILE_BYTES = 50L * 1024L * 1024L;
    private static final long MAX_ARCHIVE_BYTES = 250L * 1024L * 1024L;
    private static final int MAX_FILES = 10000;
    private static final Pattern VERSION_PATTERN = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$");
    private static final Pattern PATH_PATTERN = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._/-]*$");
    private static final Pattern SHA_PATTERN = Pattern.compile("^[a-f0-9]{64}$");

    private final File archiveRoot;
    private final File currentDirectory;
    private final File previousDirectory;
    private final Object promotionLock = new Object();
    private final Object synchronizationLock = new Object();
    private volatile boolean ready;
    private volatile File activeDirectory;
    private volatile ArchiveManifest activeManifest;

    OfflineArchiveManager(Context context) {
        archiveRoot = new File(context.getFilesDir(), "offline-arcade");
        currentDirectory = new File(archiveRoot, "current");
        previousDirectory = new File(archiveRoot, "previous");
        if (!archiveRoot.exists() && !archiveRoot.mkdirs()) {
            throw new IllegalStateException("Could not create the offline archive directory");
        }
        recoverInterruptedPromotion();
    }

    boolean isReady() {
        return ready;
    }

    String activeVersion() {
        ArchiveManifest manifest = activeManifest;
        return ready && manifest != null ? manifest.version : null;
    }

    boolean validateReadyArchive() {
        synchronized (promotionLock) {
            if (ready && activeDirectory != null && activeManifest != null) return true;
            ArchiveManifest current = readAndValidateDirectory(currentDirectory);
            if (current != null) {
                setActive(currentDirectory, current);
                return true;
            }
            ArchiveManifest previous = readAndValidateDirectory(previousDirectory);
            if (previous == null) {
                clearActive();
                return false;
            }
            deleteRecursively(currentDirectory);
            if (previousDirectory.renameTo(currentDirectory)) setActive(currentDirectory, previous);
            else setActive(previousDirectory, previous);
            return true;
        }
    }

    ArchiveManifest fetchRemoteManifest() throws IOException {
        HttpURLConnection connection = openConnection(new URL(REMOTE_BASE + MANIFEST_NAME + "?native=" + System.currentTimeMillis()), MANIFEST_READ_TIMEOUT_MS);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK || isRedirect(status) || !isExactRemote(connection.getURL(), MANIFEST_NAME)) {
                throw new IOException("Offline manifest HTTP " + status);
            }
            int declared = connection.getContentLength();
            if (declared > MAX_MANIFEST_BYTES) throw new IOException("Offline manifest length is invalid");
            byte[] bytes;
            try (InputStream input = connection.getInputStream()) {
                bytes = readLimited(input, MAX_MANIFEST_BYTES);
            }
            if (declared >= 0 && bytes.length != declared) throw new IOException("Offline manifest was incomplete");
            return parseManifest(bytes);
        } finally {
            connection.disconnect();
        }
    }

    boolean synchronize(ArchiveManifest remote) throws IOException {
        if (remote == null) throw new IOException("No remote manifest");
        synchronized (synchronizationLock) {
            ArchiveManifest existing = activeManifest;
            File sourceDirectory = activeDirectory;
            if (ready && existing != null && sameFiles(existing, remote)) return false;

            File staging = new File(archiveRoot, "staging-" + UUID.randomUUID().toString());
            if (!staging.mkdir()) throw new IOException("Could not create offline staging directory");
            try {
                for (ArchiveEntry entry : remote.files.values()) {
                    File destination = resolve(staging, entry.path);
                    File parent = destination.getParentFile();
                    if (parent == null || (!parent.exists() && !parent.mkdirs())) throw new IOException("Could not create " + entry.path);
                    ArchiveEntry oldEntry = existing == null ? null : existing.files.get(entry.path);
                    if (ready && sourceDirectory != null && entry.equalsFile(oldEntry)) {
                        File source = resolve(sourceDirectory, entry.path);
                        copyFile(source, destination, entry.bytes);
                    } else {
                        downloadFile(entry, destination);
                    }
                }
                writeManifest(staging, remote.rawBytes);
                if (!validateDirectory(staging, remote)) throw new IOException("Staged offline archive failed validation");
                promote(staging, remote);
                return true;
            } finally {
                if (staging.exists()) deleteRecursively(staging);
            }
        }
    }

    WebResourceResponse responseFor(Uri uri) {
        synchronized (promotionLock) {
            if (!ready || activeDirectory == null || activeManifest == null || !isExactRemote(uri)) return null;
            String encodedPath = uri.getEncodedPath();
            if (encodedPath == null) return null;
            String relative;
            if (encodedPath.equals("/arcade") || encodedPath.equals(REMOTE_PATH)) relative = "index.html";
            else if (encodedPath.startsWith(REMOTE_PATH)) relative = Uri.decode(encodedPath.substring(REMOTE_PATH.length()));
            else return null;
            if (MANIFEST_NAME.equals(relative)) {
                return fileResponse(new File(activeDirectory, STORED_MANIFEST_NAME), "application/json", null);
            }
            if (!safePath(relative) || !activeManifest.files.containsKey(relative)) return null;
            ArchiveEntry entry = activeManifest.files.get(relative);
            try {
                File file = resolve(activeDirectory, relative);
                if (!file.isFile() || file.length() != entry.bytes) {
                    clearActive();
                    return null;
                }
                return fileResponse(file, mimeFor(relative), entry.sha256);
            } catch (IOException error) {
                clearActive();
                return null;
            }
        }
    }

    private WebResourceResponse fileResponse(File file, String mime, String sha256) {
        try {
            FileInputStream input = new FileInputStream(file);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store, max-age=0");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Length", Long.toString(file.length()));
            if (sha256 != null) headers.put("X-Arcade-SHA256", sha256);
            String encoding = textual(mime) ? "UTF-8" : null;
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, input);
        } catch (IOException error) {
            return null;
        }
    }

    private void promote(File staging, ArchiveManifest manifest) throws IOException {
        synchronized (promotionLock) {
            File oldDirectory = activeDirectory;
            ArchiveManifest oldManifest = activeManifest;
            if (oldDirectory != null && oldDirectory.equals(previousDirectory)) {
                deleteRecursively(currentDirectory);
                if (currentDirectory.exists()) throw new IOException("Could not clear an invalid offline archive");
                if (!staging.renameTo(currentDirectory)) throw new IOException("Could not activate the staged offline archive");
                setActive(currentDirectory, manifest);
                return;
            }
            if (previousDirectory.exists()) {
                deleteRecursively(previousDirectory);
                if (previousDirectory.exists()) throw new IOException("Could not clear the prior offline backup");
            }
            boolean movedCurrent = !currentDirectory.exists() || currentDirectory.renameTo(previousDirectory);
            if (!movedCurrent) throw new IOException("Could not preserve the current offline archive");
            if (!staging.renameTo(currentDirectory)) {
                if (!currentDirectory.exists() && previousDirectory.exists()) previousDirectory.renameTo(currentDirectory);
                if (oldManifest != null && currentDirectory.isDirectory()) setActive(currentDirectory, oldManifest);
                else clearActive();
                throw new IOException("Could not activate the staged offline archive");
            }
            setActive(currentDirectory, manifest);
        }
    }

    private void recoverInterruptedPromotion() {
        synchronized (promotionLock) {
            if (!currentDirectory.exists() && previousDirectory.isDirectory()) previousDirectory.renameTo(currentDirectory);
            File[] children = archiveRoot.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (child.getName().startsWith("staging-") && child.isDirectory()) deleteRecursively(child);
                }
            }
        }
    }

    private ArchiveManifest readAndValidateDirectory(File directory) {
        if (!directory.isDirectory()) return null;
        try {
            File manifestFile = new File(directory, STORED_MANIFEST_NAME);
            if (!manifestFile.isFile() || manifestFile.length() <= 0 || manifestFile.length() > MAX_MANIFEST_BYTES) return null;
            byte[] bytes;
            try (InputStream input = new FileInputStream(manifestFile)) {
                bytes = readLimited(input, MAX_MANIFEST_BYTES);
            }
            ArchiveManifest manifest = parseManifest(bytes);
            return validateDirectory(directory, manifest) ? manifest : null;
        } catch (Exception error) {
            return null;
        }
    }

    private boolean validateDirectory(File directory, ArchiveManifest manifest) {
        try {
            for (ArchiveEntry entry : manifest.files.values()) {
                File file = resolve(directory, entry.path);
                if (!file.isFile() || file.length() != entry.bytes || !entry.sha256.equals(hashFile(file, entry.bytes))) return false;
            }
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    private void downloadFile(ArchiveEntry entry, File destination) throws IOException {
        File temporary = new File(destination.getParentFile(), destination.getName() + ".part");
        HttpURLConnection connection = openConnection(new URL(REMOTE_BASE + entry.path), FILE_READ_TIMEOUT_MS);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK || isRedirect(status) || !isExactRemote(connection.getURL(), entry.path)) {
                throw new IOException(entry.path + ": HTTP " + status);
            }
            long declared = connection.getContentLength();
            if (declared >= 0 && declared != entry.bytes) throw new IOException(entry.path + ": unexpected length");
            MessageDigest digest = digest();
            long total = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > entry.bytes || total > MAX_FILE_BYTES) throw new IOException(entry.path + ": file is too large");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if (total != entry.bytes || !entry.sha256.equals(hex(digest.digest()))) throw new IOException(entry.path + ": integrity check failed");
            if (!temporary.renameTo(destination)) throw new IOException(entry.path + ": could not publish downloaded file");
        } finally {
            connection.disconnect();
            if (temporary.exists()) temporary.delete();
        }
    }

    private static void copyFile(File source, File destination, long expectedBytes) throws IOException {
        if (!source.isFile() || source.length() != expectedBytes) throw new IOException("Reusable archive file is unavailable");
        long total = 0;
        try (InputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > expectedBytes) throw new IOException("Reusable archive file changed");
                output.write(buffer, 0, count);
            }
            output.getFD().sync();
        }
        if (total != expectedBytes) throw new IOException("Reusable archive file was incomplete");
    }

    private static void writeManifest(File directory, byte[] bytes) throws IOException {
        File temporary = new File(directory, STORED_MANIFEST_NAME + ".part");
        File target = new File(directory, STORED_MANIFEST_NAME);
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(bytes);
            output.getFD().sync();
        }
        if (!temporary.renameTo(target)) throw new IOException("Could not publish the offline manifest");
    }

    private static HttpURLConnection openConnection(URL url, int readTimeout) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(readTimeout);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("User-Agent", "ArcadePlatform/2.3.0");
        return connection;
    }

    private static ArchiveManifest parseManifest(byte[] bytes) throws IOException {
        if (bytes == null || bytes.length <= 0 || bytes.length > MAX_MANIFEST_BYTES) throw new IOException("Offline manifest size is invalid");
        try {
            JSONObject root = new JSONObject(decodeUtf8(bytes));
            if (exactLong(root.get("schema"), "schema") != 1L) throw new IOException("Unsupported offline manifest schema");
            String version = root.getString("version");
            if (!VERSION_PATTERN.matcher(version).matches()) throw new IOException("Offline manifest version is invalid");
            JSONArray array = root.getJSONArray("files");
            if (array.length() < 1 || array.length() > MAX_FILES) throw new IOException("Offline manifest file count is invalid");
            long declaredCount = exactLong(root.get("fileCount"), "fileCount");
            long declaredTotal = exactLong(root.get("totalBytes"), "totalBytes");
            if (declaredCount != array.length() || declaredTotal < 1 || declaredTotal > MAX_ARCHIVE_BYTES) throw new IOException("Offline manifest totals are invalid");
            LinkedHashMap<String, ArchiveEntry> entries = new LinkedHashMap<>();
            long total = 0;
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.getJSONObject(index);
                String path = item.getString("path");
                long size = exactLong(item.get("bytes"), "bytes");
                String sha = item.getString("sha256");
                if (!safePath(path) || entries.containsKey(path) || size < 0 || size > MAX_FILE_BYTES || !SHA_PATTERN.matcher(sha).matches()) {
                    throw new IOException("Offline manifest entry is invalid");
                }
                total += size;
                if (total < 0 || total > MAX_ARCHIVE_BYTES) throw new IOException("Offline archive is too large");
                entries.put(path, new ArchiveEntry(path, size, sha));
            }
            if (total != declaredTotal || !entries.containsKey("index.html") || !entries.containsKey("catalog.json") || !entries.containsKey("sw.js")) {
                throw new IOException("Offline manifest is incomplete");
            }
            return new ArchiveManifest(version, entries, bytes.clone());
        } catch (JSONException | CharacterCodingException error) {
            throw new IOException("Offline manifest JSON is invalid", error);
        }
    }

    private static long exactLong(Object value, String label) throws IOException {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            throw new IOException("Offline manifest " + label + " is not an integer");
        }
        return ((Number) value).longValue();
    }

    private static String decodeUtf8(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString();
    }

    private static byte[] readLimited(InputStream input, long limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw new IOException("Response exceeded its size limit");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static String hashFile(File file, long expectedBytes) throws IOException {
        MessageDigest digest = digest();
        long total = 0;
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > expectedBytes) throw new IOException("File changed while validating");
                digest.update(buffer, 0, count);
            }
        }
        if (total != expectedBytes) throw new IOException("File was incomplete");
        return hex(digest.digest());
    }

    private static MessageDigest digest() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("SHA-256 is unavailable", error);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) output.append(String.format(Locale.US, "%02x", value & 0xff));
        return output.toString();
    }

    private static File resolve(File directory, String relativePath) throws IOException {
        if (!safePath(relativePath)) throw new IOException("Unsafe offline path");
        File target = new File(directory, relativePath.replace('/', File.separatorChar));
        String root = directory.getCanonicalPath();
        String resolved = target.getCanonicalPath();
        if (!resolved.startsWith(root + File.separator)) throw new IOException("Offline path escaped its directory");
        return target;
    }

    private static boolean safePath(String path) {
        if (path == null || MANIFEST_NAME.equals(path) || !PATH_PATTERN.matcher(path).matches() || path.contains("//")) return false;
        String[] parts = path.split("/");
        for (String part : parts) if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return false;
        return true;
    }

    private static boolean isExactRemote(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && REMOTE_HOST.equalsIgnoreCase(uri.getHost()) && uri.getPort() == -1;
    }

    private static boolean isExactRemote(URL url, String relativePath) {
        return url != null && "https".equalsIgnoreCase(url.getProtocol()) && REMOTE_HOST.equalsIgnoreCase(url.getHost()) && url.getPort() == -1 &&
            (REMOTE_PATH + relativePath).equals(url.getPath());
    }

    private static boolean isRedirect(int status) {
        return status >= 300 && status < 400;
    }

    private static boolean sameFiles(ArchiveManifest left, ArchiveManifest right) {
        if (!left.version.equals(right.version) || left.files.size() != right.files.size()) return false;
        for (Map.Entry<String, ArchiveEntry> item : left.files.entrySet()) {
            if (!item.getValue().equalsFile(right.files.get(item.getKey()))) return false;
        }
        return true;
    }

    private void setActive(File directory, ArchiveManifest manifest) {
        activeDirectory = directory;
        activeManifest = manifest;
        ready = true;
    }

    private void clearActive() {
        ready = false;
        activeDirectory = null;
        activeManifest = null;
    }

    private static void deleteRecursively(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        target.delete();
    }

    private static boolean textual(String mime) {
        return mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg");
    }

    private static String mimeFor(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    static final class ArchiveManifest {
        final String version;
        final Map<String, ArchiveEntry> files;
        final byte[] rawBytes;

        ArchiveManifest(String version, LinkedHashMap<String, ArchiveEntry> files, byte[] rawBytes) {
            this.version = version;
            this.files = Collections.unmodifiableMap(files);
            this.rawBytes = rawBytes;
        }
    }

    private static final class ArchiveEntry {
        final String path;
        final long bytes;
        final String sha256;

        ArchiveEntry(String path, long bytes, String sha256) {
            this.path = path;
            this.bytes = bytes;
            this.sha256 = sha256;
        }

        boolean equalsFile(ArchiveEntry other) {
            return other != null && bytes == other.bytes && sha256.equals(other.sha256);
        }
    }
}
