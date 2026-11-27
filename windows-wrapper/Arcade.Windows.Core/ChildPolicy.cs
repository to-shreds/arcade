using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arcade.Windows.Core;

public sealed record ChildActivity(string Id, string Title, string Entry, string Icon);
public sealed record SnapshotPolicy(string Version, ChildActivity[] Activities);

public sealed partial class ChildSnapshot : IDisposable
{
    public const string Origin = "https://arcade-child.invalid";
    public const string Home = "index.html";
    public const string HomeUri = Origin + "/" + Home;
    private const string Metadata = "child-snapshot.json";
    private readonly ZipArchive archive;
    private readonly Dictionary<string, ZipArchiveEntry> assets;

    public SnapshotPolicy Policy { get; }

    public ChildSnapshot(Stream package)
    {
        var openedArchive = new ZipArchive(package, ZipArchiveMode.Read);
        try
        {
            var records = openedArchive.Entries.ToDictionary(record => record.FullName, StringComparer.Ordinal);
            if (!records.Remove(Metadata, out var metadata))
                throw new InvalidDataException("The Arcade snapshot does not have a policy.");
            using var stream = metadata.Open();
            Policy = JsonSerializer.Deserialize<SnapshotPolicy>(stream,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("The Arcade snapshot policy could not be read.");
            if (records.Keys.Any(path => !IsSafePath(path) || ContentType(path) is null) ||
                records.ContainsKey(Home) || string.IsNullOrWhiteSpace(Policy.Version) ||
                Policy.Activities.Length == 0 ||
                Policy.Activities.Select(activity => activity.Id).Distinct(StringComparer.Ordinal).Count() != Policy.Activities.Length ||
                records.Keys.Any(path => path.EndsWith(".html", StringComparison.Ordinal) &&
                    !Policy.Activities.Any(activity => activity.Entry == path)))
                throw new InvalidDataException("The Arcade snapshot policy is invalid.");
            foreach (var activity in Policy.Activities)
            {
                if (!SegmentPattern().IsMatch(activity.Id) ||
                    string.IsNullOrWhiteSpace(activity.Title) ||
                    activity.Entry != $"{activity.Id}/index.html" ||
                    !activity.Icon.StartsWith(activity.Id + "/", StringComparison.Ordinal) ||
                    !records.ContainsKey(activity.Entry) || !records.ContainsKey(activity.Icon))
                    throw new InvalidDataException("An Arcade activity is missing its entry or icon.");
            }
            assets = records;
            archive = openedArchive;
        }
        catch
        {
            openedArchive.Dispose();
            throw;
        }
    }

    public string? NavigationPath(string uri, ISet<string> allowed)
    {
        var path = RequestPath(uri);
        if (path == Home) return path;
        return Policy.Activities.Any(activity => activity.Entry == path && allowed.Contains(activity.Id)) ? path : null;
    }

    public string? ResourcePath(string uri, ISet<string> allowed)
    {
        var path = RequestPath(uri);
        if (path == Home) return path;
        if (path is null || !assets.ContainsKey(path)) return null;
        if (path.StartsWith("reference/", StringComparison.Ordinal) ||
            path is "dictionary/ui.mjs" or "dictionary/definition.mjs" or "dictionary/reference.css")
            return allowed.Contains("encyclopedia") || allowed.Contains("dictionary") ? path : null;
        var activity = Policy.Activities.FirstOrDefault(activity => path.StartsWith(activity.Id + "/", StringComparison.Ordinal));
        return activity is null || allowed.Contains(activity.Id) ? path : null;
    }

    public MemoryStream Read(string approvedPath)
    {
        var entry = assets[approvedPath];
        if (entry.Length > 16 * 1024 * 1024)
            throw new InvalidDataException("The Arcade asset exceeds the per-file package limit.");
        var output = new MemoryStream((int)entry.Length);
        using var input = entry.Open();
        input.CopyTo(output);
        output.Position = 0;
        return output;
    }

    public static string? RequestPath(string uri)
    {
        const string prefix = Origin + "/";
        if (!uri.StartsWith(prefix, StringComparison.Ordinal) || uri.Length > 4096) return null;
        var target = uri[prefix.Length..];
        var fragment = target.IndexOf('#');
        if (fragment >= 0) target = target[..fragment];
        if (target.Contains('?')) return null;
        if (target.Length == 0) return Home;
        return IsSafePath(target) ? target : null;
    }

    private static bool IsSafePath(string path) => path.Length <= 250 &&
        path.Split('/').All(part => part is not ("." or "..") && SegmentPattern().IsMatch(part));

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]*$", RegexOptions.CultureInvariant)]
    private static partial Regex SegmentPattern();

    public static string? ContentType(string path) => Path.GetExtension(path) switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".woff2" => "font/woff2",
        ".wav" => "audio/wav",
        ".ogg" => "audio/ogg",
        ".mp3" => "audio/mpeg",
        _ => null
    };

    public void Dispose() => archive.Dispose();
}
