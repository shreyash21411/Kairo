using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

/// <summary>
/// Phase 1: BM25 keyword search over the active scoped memory corpus.
///
/// Implements the standard Okapi BM25 formula:
///
///   score(D, Q) = Σ_t [ IDF(t) * TF(t,D) * (k1 + 1) / (TF(t,D) + k1 * (1 - b + b * |D| / avgdl)) ]
///
///   IDF(t) = ln(1 + (N - DF(t) + 0.5) / (DF(t) + 0.5))
///
///   Parameters:
///     k1   = 1.2   (term frequency saturation)
///     b    = 0.75  (document length normalization)
///
/// The corpus is ALWAYS the caller's authorized scoped active memories only.
/// IDF is NEVER computed from memories outside the caller's scope.
/// </summary>
public class KeywordSearchRepository : IKeywordSearchRepository
{
    private readonly KairoDbContext _dbContext;
    private readonly Kairo.Application.Abstractions.Security.IApiKeyContext? _apiKeyContext;

    // BM25 parameters
    private const double K1 = 1.2;
    private const double B  = 0.75;

    // Stop words — common terms that add noise without BM25 signal.
    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "shall",
        "should", "may", "might", "can", "could", "i", "me", "my", "we",
        "our", "you", "your", "he", "she", "it", "they", "them", "their",
        "what", "which", "who", "whom", "this", "that", "these", "those",
        "am", "to", "at", "by", "for", "in", "of", "on", "or", "and", "not",
        "with", "from", "as", "into", "through", "during", "before", "after"
    };

    public KeywordSearchRepository(
        KairoDbContext dbContext,
        Kairo.Application.Abstractions.Security.IApiKeyContext? apiKeyContext = null)
    {
        _dbContext = dbContext;
        _apiKeyContext = apiKeyContext;
    }

    private long? GetEffectiveProjectId(long? explicitProjectId = null)
    {
        if (explicitProjectId.HasValue && explicitProjectId.Value > 0)
            return explicitProjectId.Value;

        if (_apiKeyContext != null && _apiKeyContext.ProjectId > 0)
            return _apiKeyContext.ProjectId;

        return null;
    }

    public Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit = 30,
        CancellationToken cancellationToken = default)
    {
        return SearchAsync(userId, query, scopeId, limit, null, null, null, null, cancellationToken);
    }

    public Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        long? projectId,
        CancellationToken cancellationToken = default)
    {
        return SearchAsync(userId, query, scopeId, limit, null, null, null, projectId, cancellationToken);
    }

    public Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        CancellationToken cancellationToken = default)
    {
        return SearchAsync(userId, query, scopeId, limit, temporalFilter, metadataFilters, null, null, cancellationToken);
    }

    public Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters,
        CancellationToken cancellationToken = default)
    {
        return SearchAsync(userId, query, scopeId, limit, temporalFilter, metadataFilters, categoryFilters, null, cancellationToken);
    }

    public async Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters,
        long? projectId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<KeywordSearchResult>();

        // Tokenize the query (preserves stop-word removal; no dedup — IDF only needs distinct query terms)
        var queryTerms = TokenizeForBm25(query);
        if (queryTerms.Count == 0)
            return new List<KeywordSearchResult>();

        // ── Step 1: Load the entire authorized scoped active & unexpired memory corpus ────
        var now = DateTime.UtcNow;
        var memoriesQuery = _dbContext.Memories
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.IsActive && (m.ExpiresAt == null || m.ExpiresAt > now));

        var effectiveProjectId = GetEffectiveProjectId(projectId);
        if (effectiveProjectId.HasValue)
        {
            memoriesQuery = memoriesQuery.Where(m => m.ScopeId != null && m.Scope!.ProjectId == effectiveProjectId.Value);
        }

        if (scopeId.HasValue)
            memoriesQuery = memoriesQuery.Where(m => m.ScopeId == scopeId.Value);

        if (categoryFilters != null && categoryFilters.Count > 0)
        {
            var normalizedFilters = categoryFilters.Select(c => c.Trim().ToLowerInvariant()).ToList();
            memoriesQuery = memoriesQuery.Where(m => m.MemoryCategories.Any(c => normalizedFilters.Contains(c.Category)));
        }

        if (temporalFilter != null)
        {
            var effectiveCreatedAtFrom = temporalFilter.GetEffectiveCreatedAtFrom();
            if (effectiveCreatedAtFrom.HasValue)
            {
                memoriesQuery = memoriesQuery.Where(m => m.CreatedAt >= effectiveCreatedAtFrom.Value);
            }
            if (temporalFilter.CreatedAtTo.HasValue)
            {
                memoriesQuery = memoriesQuery.Where(m => m.CreatedAt <= temporalFilter.CreatedAtTo.Value);
            }
            if (temporalFilter.UpdatedAtFrom.HasValue)
            {
                memoriesQuery = memoriesQuery.Where(m => m.UpdatedAt >= temporalFilter.UpdatedAtFrom.Value);
            }
            if (temporalFilter.UpdatedAtTo.HasValue)
            {
                memoriesQuery = memoriesQuery.Where(m => m.UpdatedAt <= temporalFilter.UpdatedAtTo.Value);
            }
            if (temporalFilter.OccurredAtFrom.HasValue)
            {
                memoriesQuery = memoriesQuery.Where(m => m.OccurredAt != null && m.OccurredAt >= temporalFilter.OccurredAtFrom.Value);
            }
            if (temporalFilter.OccurredAtTo.HasValue)
            {
                memoriesQuery = memoriesQuery.Where(m => m.OccurredAt != null && m.OccurredAt <= temporalFilter.OccurredAtTo.Value);
            }
        }

        var candidateRows = await memoriesQuery
            .Select(m => new { m.MemoryId, m.Content, m.MemoryType, m.Metadata })
            .ToListAsync(cancellationToken);

        var corpus = candidateRows
            .Where(m => metadataFilters == null || metadataFilters.Count == 0 || MetadataFilterEvaluator.Matches(m.Metadata, metadataFilters))
            .Select(m => new { m.MemoryId, m.Content, m.MemoryType })
            .ToList();

        if (corpus.Count == 0)
            return new List<KeywordSearchResult>();


        // ── Step 2: Tokenize each document and compute per-document TF ────────

        // tokens[i] = list of ALL tokens in document i (with repetitions for TF)
        var docTokens = corpus
            .Select(m => TokenizeForBm25WithRepeats(m.Content))
            .ToList();

        int N = corpus.Count;

        // ── Step 3: Compute document frequencies (DF) for each query term ─────
        // DF(t) = number of documents that contain term t at least once.

        var df = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var term in queryTerms)
        {
            int count = 0;
            foreach (var tokens in docTokens)
            {
                if (tokens.Contains(term, StringComparer.OrdinalIgnoreCase))
                    count++;
            }
            df[term] = count;
        }

        // ── Step 4: Compute average document length (avgdl) ───────────────────

        double avgdl = docTokens.Count > 0
            ? docTokens.Average(t => (double)t.Count)
            : 1.0;

        // Avoid division by zero
        if (avgdl < 1e-9) avgdl = 1.0;

        // ── Step 5: Compute IDF for each query term ───────────────────────────
        // IDF(t) = ln(1 + (N - DF(t) + 0.5) / (DF(t) + 0.5))

        var idf = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var term in queryTerms)
        {
            int dft = df.TryGetValue(term, out var v) ? v : 0;
            idf[term] = Math.Log(1.0 + (N - dft + 0.5) / (dft + 0.5));
        }

        // ── Step 6: Score each document with BM25 ────────────────────────────

        var results = new List<KeywordSearchResult>();

        for (int i = 0; i < corpus.Count; i++)
        {
            var mem    = corpus[i];
            var tokens = docTokens[i];
            int dl     = tokens.Count;

            double bm25Score = 0.0;

            foreach (var term in queryTerms)
            {
                // TF(t, D) = occurrences of term t in this document
                int tf = tokens.Count(t => string.Equals(t, term, StringComparison.OrdinalIgnoreCase));
                if (tf == 0) continue;

                double idfTerm = idf.TryGetValue(term, out var iv) ? iv : 0.0;

                // BM25 numerator and denominator
                double numerator   = tf * (K1 + 1.0);
                double denominator = tf + K1 * (1.0 - B + B * dl / avgdl);

                bm25Score += idfTerm * numerator / denominator;
            }

            if (bm25Score > 0.0)
            {
                results.Add(new KeywordSearchResult
                {
                    MemoryId   = mem.MemoryId,
                    Content    = mem.Content,
                    MemoryType = mem.MemoryType ?? string.Empty,
                    RawScore   = bm25Score
                });
            }
        }

        // ── Step 7: Rank by BM25 score, apply limit ───────────────────────────
        return results
            .OrderByDescending(r => r.RawScore)
            .Take(limit)
            .ToList();
    }

    // ── Tokenizers ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Tokenizes query text into distinct filtered terms for IDF/query matching.
    /// Removes stop words and very short tokens. Deduplication is safe for query terms
    /// because we only need each distinct term once to compute the BM25 contribution.
    /// </summary>
    public static List<string> TokenizeForBm25(string text)
    {
        return text
            .ToLowerInvariant()
            .Split(Separators, StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length >= 2 && !StopWords.Contains(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Tokenizes document text preserving ALL token repetitions.
    /// TF computation REQUIRES repeated terms — "python python python" must
    /// produce TF=3, not TF=1.
    /// </summary>
    public static List<string> TokenizeForBm25WithRepeats(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return new List<string>();

        return text
            .ToLowerInvariant()
            .Split(Separators, StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length >= 2 && !StopWords.Contains(t))
            .ToList();   // NO Distinct — repetitions are intentional for TF
    }

    private static readonly char[] Separators =
    {
        ' ', '\t', '\n', '\r', '.', ',', '?', '!', ';', ':', '-', '_',
        '/', '\\', '(', ')', '[', ']', '{', '}', '"', '\'', '`', '~',
        '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '|'
    };
}
