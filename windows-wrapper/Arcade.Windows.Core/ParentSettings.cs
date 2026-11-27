using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Arcade.Windows.Core;

public sealed record ParentPassword(byte[] Salt, byte[] Hash)
{
    private const int Iterations = 600_000;
    private const int SaltLength = 32;
    private const int HashLength = 32;

    public static bool IsValidLength(string password) => password.Length is >= 8 and <= 128;

    public static ParentPassword Create(string password)
    {
        if (!IsValidLength(password))
            throw new ArgumentException("Use 8 to 128 characters for the parent password.", nameof(password));
        var salt = RandomNumberGenerator.GetBytes(SaltLength);
        return new(salt, Derive(password, salt));
    }

    [JsonIgnore]
    public bool IsWellFormed => Salt?.Length == SaltLength && Hash?.Length == HashLength;

    public bool Verify(string password)
    {
        if (!IsWellFormed || !IsValidLength(password)) return false;
        byte[] candidate = Derive(password, Salt);
        try
        {
            return CryptographicOperations.FixedTimeEquals(Hash, candidate);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(candidate);
        }
    }

    private static byte[] Derive(string password, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashLength);
}

public sealed class PasswordRetry
{
    private readonly TimeProvider clock;
    private long failedAt;
    private int failures;
    private TimeSpan delay;

    public PasswordRetry(TimeProvider? clock = null) => this.clock = clock ?? TimeProvider.System;

    public bool Ready => failures == 0 || clock.GetElapsedTime(failedAt) >= delay;

    public void RecordFailure()
    {
        failures = Math.Min(failures + 1, 4);
        failedAt = clock.GetTimestamp();
        delay = TimeSpan.FromSeconds(1 << (failures - 1));
    }

    public void RecordSuccess() => failures = 0;
}

public sealed record ParentSettings(int Schema, ParentPassword Password, string[] ApprovedActivityIds)
{
    public static ParentSettings? Load(string path)
    {
        if (!File.Exists(path)) return null;
        using var file = File.OpenRead(path);
        if (file.Length > 64 * 1024) throw new InvalidDataException("Parent settings are too large.");
        var settings = JsonSerializer.Deserialize<ParentSettings>(file);
        if (settings is null || settings.Schema != 1 || settings.Password?.IsWellFormed is not true ||
            settings.ApprovedActivityIds is null || settings.ApprovedActivityIds.Any(string.IsNullOrWhiteSpace))
            throw new InvalidDataException("Parent settings are damaged.");
        return settings;
    }

    public void Save(string path)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = File.Open(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, this);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
