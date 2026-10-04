using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

/// <summary>
/// Phase 1: Keyword search over active memories using SQL LIKE pattern matching.
/// This provides BM25-like signals without requiring SQL Server Full-Text Search.
/// Score = number of distinct query words found in the memory content.
/// </summary>
public class KeywordSearchRepository : IKeywordSearchRepository
{
    private readonly KairoDbContext _dbContext;

    // Stop words — common terms that add noise without signal.
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

    public KeywordSearchRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<List<KeywordSearchResult>> SearchAsync(
        long userId,
        string query,
        long? scopeId,
        int limit = 30,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<KeywordSearchResult>();

        // Extract meaningful keywords from the query
        var keywords = ExtractKeywords(query);
        if (keywords.Count == 0)
            return new List<KeywordSearchResult>();

        // Load active memories for this user/scope
        var memoriesQuery = _dbContext.Memories
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.IsActive);

        if (scopeId.HasValue)
            memoriesQuery = memoriesQuery.Where(m => m.ScopeId == scopeId.Value);

        var memories = await memoriesQuery
            .Select(m => new { m.MemoryId, m.Content, m.MemoryType })
            .ToListAsync(cancellationToken);

        // Score each memory by keyword overlap (in-process)
        var results = new List<KeywordSearchResult>();

        foreach (var memory in memories)
        {
            if (string.IsNullOrWhiteSpace(memory.Content))
                continue;

            var contentLower = memory.Content.ToLowerInvariant();
            var matchCount   = keywords.Count(kw => contentLower.Contains(kw));

            if (matchCount > 0)
            {
                results.Add(new KeywordSearchResult
                {
                    MemoryId   = memory.MemoryId,
                    Content    = memory.Content,
                    MemoryType = memory.MemoryType ?? string.Empty,
                    RawScore   = matchCount
                });
            }
        }

        return results
            .OrderByDescending(r => r.RawScore)
            .Take(limit)
            .ToList();
    }

    private static List<string> ExtractKeywords(string query)
    {
        // Tokenize and filter stop words + short tokens
        return query
            .ToLowerInvariant()
            .Split(new[] { ' ', '\t', '\n', '\r', '.', ',', '?', '!', ';', ':', '-', '_' },
                   StringSplitOptions.RemoveEmptyEntries)
            .Where(token => token.Length >= 3 && !StopWords.Contains(token))
            .Distinct()
            .ToList();
    }
}
