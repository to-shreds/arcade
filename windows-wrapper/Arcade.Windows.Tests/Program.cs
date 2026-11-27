using System.Buffers.Binary;
using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using Arcade.Windows.Core;

if (args.Length is < 1 or > 2)
    throw new ArgumentException("Pass the child-snapshot.zip path and, optionally, the published Arcade.dll.");
using var package = File.OpenRead(args[0]);
using var snapshot = new ChildSnapshot(package);
var activity = snapshot.Policy.Activities[0];
var allow = new HashSet<string>(StringComparer.Ordinal) { activity.Id };
var denyAll = new HashSet<string>(StringComparer.Ordinal);
var baseUrl = ChildSnapshot.Origin;
var activityUrl = $"{baseUrl}/{activity.Entry}";
int assertions = 0;

void Check(bool condition, string title)
{
    if (!condition) throw new Exception(title);
    assertions++;
}

Check(snapshot.NavigationPath(baseUrl + "/", denyAll) == ChildSnapshot.Home, "exact root home");
Check(snapshot.NavigationPath(ChildSnapshot.HomeUri, denyAll) == ChildSnapshot.Home, "explicit home path");
Check(snapshot.NavigationPath(activityUrl, allow) == activity.Entry, "approved entry");
Check(snapshot.NavigationPath(activityUrl + "#article=birds", allow) == activity.Entry, "approved fragment");
Check(snapshot.NavigationPath(activityUrl, denyAll) is null, "parent-revoked entry");
Check(snapshot.ResourcePath($"{baseUrl}/{activity.Icon}", allow) == activity.Icon, "approved icon");
Check(snapshot.ResourcePath($"{baseUrl}/{activity.Icon}", denyAll) is null, "parent-revoked icon");
Check(snapshot.ResourcePath($"{baseUrl}/arcade-save.js", denyAll) == "arcade-save.js", "shared asset");
Check(snapshot.NavigationPath($"{baseUrl}/arcade-save.js", allow) is null, "asset is never a document");
Check(snapshot.ResourcePath($"{baseUrl}/child-snapshot.json", allow) is null, "policy is native-only");

foreach (var uri in new[]
{
    $"https://arcade-child.invalid.example/{activity.Entry}",
    $"https://someone@arcade-child.invalid/{activity.Entry}",
    $"https://arcade-child.invalid@external.invalid/{activity.Entry}",
    $"https://arcade-child.invalid:443/{activity.Entry}",
    $"http://arcade-child.invalid/{activity.Entry}",
    $"https://ARCADE-CHILD.INVALID/{activity.Entry}",
    $"{baseUrl}//{activity.Entry}",
    $"{baseUrl}/../{activity.Entry}",
    $"{baseUrl}/%2e/{activity.Entry}",
    $"{baseUrl}/{activity.Id}%2findex.html",
    $"{baseUrl}/{activity.Id}/%69ndex.html",
    $"{baseUrl}/{activity.Id}/index.html/extra",
    $"{baseUrl}/other{activity.Entry}",
    $"{baseUrl}/{activity.Id}\\index.html",
    $"{baseUrl}/{activity.Id}/index.html?room=ABCDEF",
    $"{baseUrl}/chat-room/index.html",
    $"{baseUrl}/comic-reader/index.html",
    $"{baseUrl}/tv/index.html",
    $"{baseUrl}/retro-vault/index.html",
    $"{baseUrl}/sw.js",
    "file:///C:/Windows/System32/drivers/etc/hosts",
    "about:blank", "data:text/html,<b>x</b>", "javascript:alert(0)",
    "ms-settings:network-wifi", "blob:https://arcade-child.invalid/anything"
})
{
    Check(snapshot.NavigationPath(uri, allow) is null, "deny navigation: " + uri);
    Check(snapshot.ResourcePath(uri, allow) is null, "deny resource: " + uri);
}

foreach (var item in snapshot.Policy.Activities)
{
    using var page = snapshot.Read(item.Entry);
    Check(page.Length > 0 && ChildSnapshot.ContentType(item.Entry)?.StartsWith("text/html") == true, "packaged page " + item.Id);
    using var icon = snapshot.Read(item.Icon);
    Check(icon.Length > 0, "packaged icon " + item.Id);
}

if (snapshot.Policy.Activities.Any(item => item.Id == "encyclopedia"))
{
    var referenceOnly = new HashSet<string>(StringComparer.Ordinal) { "encyclopedia" };
    Check(snapshot.NavigationPath($"{baseUrl}/dictionary/index.html", referenceOnly) is null,
        "standalone dictionary denied when only Encyclopedia approved");
    foreach (var asset in new[] { "dictionary/ui.mjs", "dictionary/definition.mjs",
                 "dictionary/reference.css", "reference/packs/catalog.json" })
    {
        Check(snapshot.ResourcePath($"{baseUrl}/{asset}", referenceOnly) == asset,
            "Encyclopedia retains shared lookup dependency: " + asset);
        Check(snapshot.ResourcePath($"{baseUrl}/{asset}", denyAll) is null,
            "shared lookup dependency denied when both activities off: " + asset);
    }
}
using (var input = File.OpenRead(args[0]))
using (var zip = new ZipArchive(input, ZipArchiveMode.Read))
{
    foreach (var entry in zip.Entries.Where(entry => entry.FullName.StartsWith("multiplayer/", StringComparison.Ordinal)))
    {
        using var reader = new StreamReader(entry.Open(), Encoding.UTF8);
        Check(reader.ReadToEnd().Trim() == "/* Multiplayer is disabled in Arcade for Windows child mode. */",
            "packaged multiplayer script cannot start network");
    }
}

if (args.Length == 2)
{
    using var executable = new PEReader(File.OpenRead(args[1]));
    var metadata = executable.GetMetadataReader();
    var entry = metadata.ManifestResources.Select(metadata.GetManifestResource)
        .Single(resource => metadata.GetString(resource.Name) == "Arcade.ChildSnapshot.zip");
    var section = executable.GetSectionData(executable.PEHeaders.CorHeader!.ResourcesDirectory.RelativeVirtualAddress);
    int offset = checked((int)entry.Offset);
    int length = BinaryPrimitives.ReadInt32LittleEndian(section.GetContent(offset, sizeof(int)).AsSpan());
    Check(entry.Implementation.IsNil, "snapshot is an embedded resource");
    Check(length == package.Length, "embedded snapshot length");
    var packaged = section.GetContent(offset + sizeof(int), length);
    using var snapshotFile = File.OpenRead(args[0]);
    Check(SHA256.HashData(packaged.AsSpan()).SequenceEqual(SHA256.HashData(snapshotFile)), "embedded snapshot SHA-256");
}

var secret = Guid.NewGuid().ToString("N");
var password = ParentPassword.Create(secret);
var independent = ParentPassword.Create(secret);
Check(!password.Salt.SequenceEqual(independent.Salt), "random unique salt");
Check(!password.Hash.SequenceEqual(independent.Hash), "distinct hashes for the same password");
Check(password.Verify(secret), "correct password");
Check(!password.Verify(Guid.NewGuid().ToString("N")), "wrong password");
Check(!password.Verify("abc"), "short input");
Check(!new ParentPassword([], []).Verify(secret), "bad password metadata");
var clock = new ManualTime();
var retry = new PasswordRetry(clock);
Check(retry.Ready, "no initial retry delay");
foreach (int seconds in new[] { 1, 2, 4, 8, 8 })
{
    retry.RecordFailure();
    clock.Advance(TimeSpan.FromSeconds(seconds) - TimeSpan.FromTicks(1));
    Check(!retry.Ready, "retry delay lasts " + seconds + " seconds");
    clock.Advance(TimeSpan.FromTicks(1));
    Check(retry.Ready, "can retry after delay");
}
retry.RecordSuccess();
retry.RecordFailure();
clock.Advance(TimeSpan.FromSeconds(1));
Check(retry.Ready, "success resets delay");
var directory = Directory.CreateTempSubdirectory("arcade-parent-test-");
try
{
    var statePath = Path.Combine(directory.FullName, "parent-settings.json");
    Check(ParentSettings.Load(statePath) is null, "first run settings absent");
    var state = new ParentSettings(1, password, [activity.Id]);
    state.Save(statePath);
    Check(!File.ReadAllText(statePath).Contains(secret, StringComparison.Ordinal), "no plaintext password");
    var loaded = ParentSettings.Load(statePath);
    Check(loaded?.Password.Verify(secret) is true && loaded.ApprovedActivityIds.SequenceEqual([activity.Id]), "settings restore");
    var updated = state with { Password = independent, ApprovedActivityIds = [] };
    updated.Save(statePath);
    Check(ParentSettings.Load(statePath)?.ApprovedActivityIds.Length == 0, "saved allowlist replacement");
    Check(directory.GetFiles().Length == 1, "temporary file cleaned up");
    File.WriteAllText(statePath, "{}");
    try
    {
        ParentSettings.Load(statePath);
        Check(false, "damaged settings rejected");
    }
    catch (InvalidDataException)
    {
        Check(true, "damaged settings rejected");
    }
}
finally
{
    directory.Delete(recursive: true);
}

Console.WriteLine($"{assertions} assertions passed against {snapshot.Policy.Activities.Length} activities in {snapshot.Policy.Version}.");

sealed class ManualTime : TimeProvider
{
    private long timestamp;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() => timestamp;
    public void Advance(TimeSpan duration) => timestamp += duration.Ticks;
}
