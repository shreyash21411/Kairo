using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

/// <summary>
/// Phase 1: BM25/keyword search over active memories for a given user+scope.
/// Returns memories that match one or more keywords from the query using
/// SQL LIKE-based matching (SQL Server full-text search fallback).
/// </summary>
public interface IKeywordSearchRepository
{
    /// <summary>
    /// Returns memory candidates that contain keyword matches for the query terms.
    /// Scores are raw match counts (not normalized). Returns at most
    /// <paramref name="limit"/> candidates.
    /// </summary>
    Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit = 30,
        CancellationToken cancellationToken = default);

    Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        long? projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 2: Returns BM25 memory candidates with temporal and metadata filtering applied
    /// at candidate selection before corpus statistics and scoring are computed.
    /// </summary>
    Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        CancellationToken cancellationToken = default);

    Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        long? projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 3: Returns BM25 memory candidates with temporal, metadata, and category filtering applied
    /// at candidate selection before corpus statistics and scoring are computed.
    /// </summary>
    Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters,
        CancellationToken cancellationToken = default);

    Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters,
        long? projectId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// A memory candidate from keyword/BM25 search with a raw score.
/// </summary>
public class KeywordSearchResult
{
    public long MemoryId { get; set; }
    public string Content { get; set; } = null!;
    public string MemoryType { get; set; } = null!;

    /// <summary>Raw keyword match score (word overlap count, unnormalized).</summary>
    public double RawScore { get; set; }
}
