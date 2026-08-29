package com.familyarcade.platform;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public final class GameMetadata {
    public String title = "";
    public String entry = "index.html";
    public String icon = "icon.png";
    public int order = 10;
    public boolean enabled = true;
    public String type = "game";
    public int playersMin = 1;
    public int playersMax = 1;
    public final ArrayList<String> categories = new ArrayList<>();
    public final ArrayList<String> tags = new ArrayList<>();
    public String orientation = "any";

    public static GameMetadata fromJson(String text) throws JSONException {
        JSONObject json = new JSONObject(text);
        GameMetadata metadata = new GameMetadata();
        metadata.title = json.optString("title", "").trim();
        metadata.entry = json.optString("entry", "index.html").trim();
        metadata.icon = json.optString("icon", "icon.png").trim();
        metadata.order = json.optInt("order", 10);
        metadata.enabled = json.optBoolean("enabled", true);
        metadata.type = normalizeType(json.optString("type", "game"));
        metadata.playersMin = Math.max(1, json.optInt("playersMin", 1));
        metadata.playersMax = Math.max(metadata.playersMin, json.optInt("playersMax", metadata.playersMin));
        metadata.orientation = normalizeOrientation(json.optString("orientation", "any"));
        copyArray(json.optJSONArray("categories"), metadata.categories);
        copyArray(json.optJSONArray("tags"), metadata.tags);
        metadata.normalize();
        return metadata;
    }

    public static GameMetadata inferred(String folderName, String entryName, int order) {
        GameMetadata metadata = new GameMetadata();
        String spaced = folderName.replace('-', ' ').replace('_', ' ').trim();
        StringBuilder title = new StringBuilder();
        for (String part : spaced.split("\\s+")) {
            if (part.isEmpty()) continue;
            if (title.length() > 0) title.append(' ');
            title.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        metadata.title = title.length() == 0 ? "New Game" : title.toString();
        metadata.entry = entryName == null || entryName.isEmpty() ? "index.html" : entryName;
        metadata.order = order;
        return metadata;
    }

    private static void copyArray(JSONArray source, List<String> destination) {
        if (source == null) return;
        for (int i = 0; i < source.length(); i++) {
            String value = normalizeToken(source.optString(i, ""));
            if (!value.isEmpty() && !destination.contains(value)) destination.add(value);
        }
    }

    public void normalize() {
        title = title == null ? "" : title.trim();
        entry = entry == null ? "index.html" : entry.trim();
        icon = icon == null ? "" : icon.trim();
        type = normalizeType(type);
        orientation = normalizeOrientation(orientation);
        playersMin = Math.max(1, playersMin);
        playersMax = Math.max(playersMin, playersMax);
        normalizeList(categories);
        normalizeList(tags);
    }

    private static void normalizeList(ArrayList<String> list) {
        ArrayList<String> clean = new ArrayList<>();
        for (String value : list) {
            String token = normalizeToken(value);
            if (!token.isEmpty() && !clean.contains(token)) clean.add(token);
        }
        Collections.sort(clean);
        list.clear();
        list.addAll(clean);
    }

    public String validationError() {
        normalize();
        if (title.isEmpty()) return "Title is required.";
        if (!safeRelative(entry)) return "Entry must be a relative file path.";
        if (!icon.isEmpty() && !safeRelative(icon)) return "Icon must be a relative file path.";
        if (!(type.equals("game") || type.equals("activity"))) return "Type must be Game or Activity.";
        if (!(orientation.equals("any") || orientation.equals("landscape") || orientation.equals("portrait"))) return "Orientation must be Any, Landscape, or Portrait.";
        if (playersMin > playersMax || playersMax > 8) return "Player range must be between 1 and 8.";
        return null;
    }

    public String toJson() throws JSONException {
        normalize();
        JSONObject json = new JSONObject();
        json.put("title", title);
        json.put("entry", entry);
        json.put("icon", icon);
        json.put("order", order);
        json.put("enabled", enabled);
        json.put("type", type);
        json.put("multiplayer", playersMax > 1);
        json.put("playersMin", playersMin);
        json.put("playersMax", playersMax);
        json.put("categories", new JSONArray(categories));
        json.put("tags", new JSONArray(tags));
        json.put("orientation", orientation);
        return json.toString(2) + "\n";
    }

    public static boolean safeRelative(String value) {
        if (value == null || value.isEmpty() || value.startsWith("/") || value.startsWith("\\")) return false;
        String[] parts = value.replace('\\', '/').split("/");
        for (String part : parts) if (part.equals("..") || part.isEmpty()) return false;
        return true;
    }

    public static String normalizeToken(String value) {
        if (value == null) return "";
        return value.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-+|-+$)", "");
    }

    public static String normalizeType(String value) {
        if (value == null || value.trim().isEmpty()) return "game";
        return value.trim().toLowerCase(Locale.US);
    }

    public static String normalizeOrientation(String value) {
        if (value == null || value.trim().isEmpty()) return "any";
        if ("landscape".equalsIgnoreCase(value)) return "landscape";
        if ("portrait".equalsIgnoreCase(value)) return "portrait";
        if ("any".equalsIgnoreCase(value)) return "any";
        return value.trim().toLowerCase(Locale.US);
    }
}
