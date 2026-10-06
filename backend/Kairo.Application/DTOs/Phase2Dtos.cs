using System;
using System.Collections.Generic;

namespace Kairo.Application.DTOs;

// ── Phase 2: Temporal Filter DTOs ─────────────────────────────────────────────

/// <summary>
/// Phase 2: Represents temporal filtering constraints for memory retrieval.
/// Supports absolute UTC timestamp boundaries and relative-time convenience windows.
/// Boundaries are inclusive.
/// </summary>
public class MemoryTemporalFilter
{
    public DateTime? CreatedAtFrom { get; set; }
    public DateTime? CreatedAtTo { get; set; }

    public DateTime? UpdatedAtFrom { get; set; }
    public DateTime? UpdatedAtTo { get; set; }

    public DateTime? OccurredAtFrom { get; set; }
    public DateTime? OccurredAtTo { get; set; }

    /// <summary>Relative-time filter: include memories created within the last N hours.</summary>
    public int? LastHours { get; set; }

    /// <summary>Relative-time filter: include memories created within the last N days.</summary>
    public int? LastDays { get; set; }

    /// <summary>Relative-time filter: include memories created within the last N weeks.</summary>
    public int? LastWeeks { get; set; }

    /// <summary>
    /// Returns true if any temporal filter constraint is specified.
    /// </summary>
    public bool HasConstraints =>
        CreatedAtFrom.HasValue ||
        CreatedAtTo.HasValue ||
        UpdatedAtFrom.HasValue ||
        UpdatedAtTo.HasValue ||
        OccurredAtFrom.HasValue ||
        OccurredAtTo.HasValue ||
        LastHours.HasValue ||
        LastDays.HasValue ||
        LastWeeks.HasValue;

    /// <summary>
    /// Computes the effective CreatedAt lower bound taking into account
    /// relative convenience parameters (LastHours, LastDays, LastWeeks).
    /// </summary>
    public DateTime? GetEffectiveCreatedAtFrom(DateTime? nowUtc = null)
    {
        var now = nowUtc ?? DateTime.UtcNow;
        var candidates = new List<DateTime>();

        if (CreatedAtFrom.HasValue)
            candidates.Add(CreatedAtFrom.Value);

        if (LastHours.HasValue && LastHours.Value > 0)
            candidates.Add(now.AddHours(-LastHours.Value));

        if (LastDays.HasValue && LastDays.Value > 0)
            candidates.Add(now.AddDays(-LastDays.Value));

        if (LastWeeks.HasValue && LastWeeks.Value > 0)
            candidates.Add(now.AddDays(-LastWeeks.Value * 7));

        if (candidates.Count == 0)
            return null;

        // The most restrictive (latest) lower bound applies
        DateTime max = candidates[0];
        for (int i = 1; i < candidates.Count; i++)
        {
            if (candidates[i] > max)
                max = candidates[i];
        }
        return max;
    }
}

// ── Phase 2: Metadata Filter DTOs ─────────────────────────────────────────────

/// <summary>
/// Phase 2: Represents a structured metadata filter condition.
/// Supported operators: "eq" (equal), "ne" (not equal), "in" (contained in list).
/// </summary>
public class MetadataFilterCondition
{
    /// <summary>Metadata JSON property key.</summary>
    public string Key { get; set; } = null!;

    /// <summary>Comparison operator: "eq", "ne", "in". Default is "eq".</summary>
    public string Operator { get; set; } = "eq";

    /// <summary>Value for "eq" or "ne" comparisons (converted to string).</summary>
    public string? Value { get; set; }

    /// <summary>Values for "in" membership comparisons.</summary>
    public List<string>? InValues { get; set; }
}

// ── Phase 2: Graph Memory DTOs ────────────────────────────────────────────────

/// <summary>
/// Phase 2: An extracted relationship between two named entities.
/// </summary>
public class ExtractedRelationship
{
    /// <summary>Display name or identifier of the source entity.</summary>
    public string Source { get; set; } = null!;

    /// <summary>Display name or identifier of the target entity.</summary>
    public string Target { get; set; } = null!;

    /// <summary>
    /// Type/predicate of the relationship (e.g. "works_at", "attends", "located_in", "created").
    /// </summary>
    public string RelationshipType { get; set; } = null!;

    /// <summary>Confidence score between 0.0 and 1.0.</summary>
    public double Confidence { get; set; } = 1.0;
}

/// <summary>
/// Phase 2: A relationship between entities returned in search results.
/// </summary>
public class GraphRelationDto
{
    public string Source { get; set; } = null!;
    public string Relationship { get; set; } = null!;
    public string Target { get; set; } = null!;
    public double Confidence { get; set; } = 1.0;
}

/// <summary>
/// Phase 2: Combined result of hybrid retrieval with memories and scoped graph relationships.
/// </summary>
public class HybridRetrievalResult
{
    public List<RetrievedMemory> Memories { get; set; } = new();
    public List<GraphRelationDto> Relations { get; set; } = new();
}

/// <summary>
/// Internal data structure for persisted relationship graph traversal.
/// </summary>
public class GraphRelationData
{
    public long RelationshipId { get; set; }
    public long ScopeId { get; set; }
    public long SourceEntityId { get; set; }
    public string SourceDisplayName { get; set; } = null!;
    public string SourceNormalizedName { get; set; } = null!;
    public long TargetEntityId { get; set; }
    public string TargetDisplayName { get; set; } = null!;
    public string TargetNormalizedName { get; set; } = null!;
    public string RelationshipType { get; set; } = null!;
    public double Confidence { get; set; }
}

/// <summary>
/// Helper for evaluating metadata filter conditions ("eq", "ne", "in") against JSON metadata.
/// Evaluates robustly with case-insensitivity across strings, numbers, and booleans.
/// </summary>
public static class MetadataFilterEvaluator
{
    public static bool Matches(string? metadataJson, IEnumerable<MetadataFilterCondition>? conditions)
    {
        if (conditions == null) return true;
        var list = conditions.ToList();
        if (list.Count == 0) return true;

        if (string.IsNullOrWhiteSpace(metadataJson))
        {
            foreach (var cond in list)
            {
                var op = (cond.Operator ?? "eq").Trim().ToLowerInvariant();
                if (op != "ne")
                    return false;
            }
            return true;
        }

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(metadataJson);
            var root = doc.RootElement;
            if (root.ValueKind != System.Text.Json.JsonValueKind.Object)
                return false;

            foreach (var cond in list)
            {
                if (string.IsNullOrWhiteSpace(cond.Key))
                    continue;

                var op = (cond.Operator ?? "eq").Trim().ToLowerInvariant();

                System.Text.Json.JsonProperty? foundProp = null;
                foreach (var prop in root.EnumerateObject())
                {
                    if (string.Equals(prop.Name, cond.Key, StringComparison.OrdinalIgnoreCase))
                    {
                        foundProp = prop;
                        break;
                    }
                }

                if (!foundProp.HasValue)
                {
                    if (op == "ne")
                        continue;
                    return false;
                }

                var element = foundProp.Value.Value;
                string? actualStr = element.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.String => element.GetString(),
                    System.Text.Json.JsonValueKind.Number => element.GetRawText(),
                    System.Text.Json.JsonValueKind.True => "true",
                    System.Text.Json.JsonValueKind.False => "false",
                    System.Text.Json.JsonValueKind.Null => null,
                    _ => element.GetRawText()
                };

                switch (op)
                {
                    case "eq":
                        if (!string.Equals(actualStr, cond.Value, StringComparison.OrdinalIgnoreCase))
                            return false;
                        break;

                    case "ne":
                        if (string.Equals(actualStr, cond.Value, StringComparison.OrdinalIgnoreCase))
                            return false;
                        break;

                    case "in":
                        if (cond.InValues == null || cond.InValues.Count == 0)
                            return false;
                        bool foundMatch = false;
                        foreach (var target in cond.InValues)
                        {
                            if (string.Equals(actualStr, target, StringComparison.OrdinalIgnoreCase))
                            {
                                foundMatch = true;
                                break;
                            }
                        }
                        if (!foundMatch)
                            return false;
                        break;

                    default:
                        if (!string.Equals(actualStr, cond.Value, StringComparison.OrdinalIgnoreCase))
                            return false;
                        break;
                }
            }

            return true;
        }
        catch (System.Text.Json.JsonException)
        {
            foreach (var cond in list)
            {
                var op = (cond.Operator ?? "eq").Trim().ToLowerInvariant();
                if (op != "ne")
                    return false;
            }
            return true;
        }
    }
}
