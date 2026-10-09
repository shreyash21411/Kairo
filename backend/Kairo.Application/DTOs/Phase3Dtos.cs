using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Kairo.Application.DTOs;

// ── Phase 3: Category Validation & Normalization ──────────────────────────────

public static class CategoryValidator
{
    public const int MaxCategoryLength = 64;
    public const int MaxCategoriesPerMemory = 20;

    // Alphanumeric, hyphen, underscore, period
    private static readonly Regex ValidCategoryPattern = new(
        @"^[a-zA-Z0-9_\-\.]+$",
        RegexOptions.Compiled);

    /// <summary>
    /// Validates and normalizes a list of category names.
    /// Rejects malformed values, empty values, values over MaxCategoryLength,
    /// and ensures deduplication and consistent lowercase casing.
    /// </summary>
    public static List<string> ValidateAndNormalize(IEnumerable<string>? categories)
    {
        if (categories == null)
            return new List<string>();

        var normalized = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in categories)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                throw new ArgumentException("Category name cannot be empty or whitespace.");
            }

            var trimmed = raw.Trim();

            if (trimmed.Length > MaxCategoryLength)
            {
                throw new ArgumentException(
                    $"Category '{trimmed}' exceeds maximum length of {MaxCategoryLength} characters.");
            }

            if (!ValidCategoryPattern.IsMatch(trimmed))
            {
                throw new ArgumentException(
                    $"Category '{trimmed}' contains invalid characters. Only alphanumeric, hyphens, underscores, and dots are permitted.");
            }

            normalized.Add(trimmed.ToLowerInvariant());

            if (normalized.Count > MaxCategoriesPerMemory)
            {
                throw new ArgumentException(
                    $"Exceeded maximum allowed categories ({MaxCategoriesPerMemory}) per memory.");
            }
        }

        return new List<string>(normalized);
    }

    /// <summary>
    /// Validates a single category name and returns its normalized lowercased value.
    /// </summary>
    public static string ValidateAndNormalizeSingle(string category)
    {
        if (string.IsNullOrWhiteSpace(category))
            throw new ArgumentException("Category name cannot be empty or whitespace.");

        var trimmed = category.Trim();
        if (trimmed.Length > MaxCategoryLength)
            throw new ArgumentException($"Category '{trimmed}' exceeds maximum length of {MaxCategoryLength} characters.");

        if (!ValidCategoryPattern.IsMatch(trimmed))
            throw new ArgumentException($"Category '{trimmed}' contains invalid characters. Only alphanumeric, hyphens, underscores, and dots are permitted.");

        return trimmed.ToLowerInvariant();
    }
}

// ── Phase 3: Expiration / TTL Helpers ─────────────────────────────────────────

public static class ExpirationHelper
{
    /// <summary>
    /// Resolves the effective UTC ExpiresAt timestamp from explicit expiresAt and/or ttl seconds.
    /// If ttl is supplied:
    ///   - Negative ttl throws ArgumentException.
    ///   - Zero ttl produces immediate expiration (now).
    ///   - Positive ttl produces now + ttl seconds.
    /// If explicit expiresAt is supplied:
    ///   - Normalizes to UTC DateTime.
    /// Explicit expiresAt takes precedence when provided.
    /// </summary>
    public static DateTime? ResolveExpiresAt(DateTime? expiresAt, long? ttlSeconds, DateTime? referenceTimeUtc = null)
    {
        var now = referenceTimeUtc ?? DateTime.UtcNow;

        if (ttlSeconds.HasValue)
        {
            if (ttlSeconds.Value < 0)
            {
                throw new ArgumentException("TTL cannot be negative.", nameof(ttlSeconds));
            }

            if (!expiresAt.HasValue)
            {
                return ttlSeconds.Value == 0
                    ? now
                    : now.AddSeconds(ttlSeconds.Value);
            }
        }

        if (expiresAt.HasValue)
        {
            return DateTime.SpecifyKind(expiresAt.Value, DateTimeKind.Utc);
        }

        return null;
    }

    /// <summary>
    /// Returns true if the memory with given expiresAt is currently active (not expired).
    /// NULL expiresAt means the memory never expires.
    /// </summary>
    public static bool IsNotExpired(DateTime? expiresAt, DateTime? nowUtc = null)
    {
        if (!expiresAt.HasValue)
            return true;

        var now = nowUtc ?? DateTime.UtcNow;
        return expiresAt.Value > now;
    }
}

// ── Phase 3: Batch Operation DTOs ─────────────────────────────────────────────

public class BatchCreateMemoryItem
{
    public string Content { get; set; } = null!;
    public string MemoryType { get; set; } = "Explicit";
    public string? ActorId { get; set; }
    public MemoryScopeKey? Scope { get; set; }
    public DateTime? OccurredAt { get; set; }
    public Dictionary<string, object>? Metadata { get; set; }
    public List<string>? Categories { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public long? Ttl { get; set; }
}

public class BatchCreateMemoryRequest
{
    public const int MaxBatchSize = 100;

    public List<BatchCreateMemoryItem> Memories { get; set; } = new();
}

public class BatchUpdateMemoryItem
{
    public long MemoryId { get; set; }
    public string? Content { get; set; }
    public string? MemoryType { get; set; }
    public DateTime? OccurredAt { get; set; }
    public Dictionary<string, object>? Metadata { get; set; }
    public List<string>? Categories { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public long? Ttl { get; set; }
}

public class BatchUpdateMemoryRequest
{
    public const int MaxBatchSize = 100;

    public List<BatchUpdateMemoryItem> Memories { get; set; } = new();
}

public class BatchDeleteMemoryRequest
{
    public const int MaxBatchSize = 100;

    public List<long> MemoryIds { get; set; } = new();
}

public class BatchOperationError
{
    public long? MemoryId { get; set; }
    public int? Index { get; set; }
    public string Message { get; set; } = null!;
}

public class BatchCreateResponse
{
    public bool Success { get; set; }
    public int CreatedCount { get; set; }
    public List<MemoryResponse> Memories { get; set; } = new();
    public List<BatchOperationError> Errors { get; set; } = new();
}

public class BatchUpdateResponse
{
    public bool Success { get; set; }
    public int UpdatedCount { get; set; }
    public List<MemoryResponse> Memories { get; set; } = new();
    public List<BatchOperationError> Errors { get; set; } = new();
}

public class BatchDeleteResponse
{
    public bool Success { get; set; }
    public int DeletedCount { get; set; }
    public List<long> DeletedIds { get; set; } = new();
    public List<BatchOperationError> Errors { get; set; } = new();
}
