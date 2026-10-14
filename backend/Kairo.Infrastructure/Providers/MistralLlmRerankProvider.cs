using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;

namespace Kairo.Infrastructure.Providers;

/// <summary>
/// Phase 5.6 Task 5.6.1: LLM-guided continuous relevance rerank provider.
/// Uses an <see cref="ILlmProvider"/> (e.g. Mistral) with deterministic temperature (0.0) and JSON schema
/// to emit calibrated continuous relevance scores in [0.0, 1.0] for bounded candidate sets.
///
/// Scoring Mechanism Documentation:
///   This provider implements LLM zero-shot prompt-based continuous scoring. It prompts the configured LLM
///   to evaluate candidate relevance on a continuous scale [0.0, 1.0] for each candidate item in the bounded set.
///   Note: This is an LLM prompt scoring mechanism, not a native cross-encoder model.
/// </summary>
public class MistralLlmRerankProvider : IRerankProvider
{
    private readonly ILlmProvider _llmProvider;

    public string ProviderName => "Mistral-LLM";
    public string DefaultModel => _llmProvider.DefaultModel;

    public MistralLlmRerankProvider(ILlmProvider llmProvider)
    {
        _llmProvider = llmProvider ?? throw new ArgumentNullException(nameof(llmProvider));
    }

    public async Task<RerankResponse> RerankAsync(
        RerankRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (string.IsNullOrWhiteSpace(request.Query) || request.Candidates.Count == 0)
        {
            return new RerankResponse();
        }

        var candidateData = request.Candidates.Select(c => new
        {
            memoryId = c.MemoryId,
            content = c.Content
        }).ToList();

        var promptData = new
        {
            query = request.Query,
            candidates = candidateData
        };

        var userPrompt = JsonSerializer.Serialize(promptData);

        var systemPrompt = """
            You are a specialized memory relevance reranker.
            Your task is to evaluate the relevance of each candidate memory with respect to the user query.

            For each candidate memory, assign a continuous relevance score from 0.0 to 1.0:
            - 1.0: Perfect relevance — directly answers or provides essential context for the query.
            - 0.8 - 0.9: High relevance — strong semantic connection, user preference, or crucial related fact.
            - 0.5 - 0.7: Moderate relevance — partially helpful or background context.
            - 0.1 - 0.4: Weak relevance — tangential or incidental connection.
            - 0.0: Irrelevant — unrelated or merely shares coincidental words.

            You must evaluate and score every candidate provided.
            Return valid JSON adhering strictly to this structure:
            {
              "scores": [
                { "memoryId": 1, "score": 0.85 }
              ]
            }
            """;

        var completionRequest = new LlmCompletionRequest
        {
            SystemPrompt = systemPrompt,
            UserPrompt = userPrompt,
            Temperature = 0.0,
            EnforceJsonOutput = true,
            Model = request.Model ?? DefaultModel
        };

        var responseText = await _llmProvider.GenerateChatCompletionAsync(completionRequest, cancellationToken);

        if (string.IsNullOrWhiteSpace(responseText))
        {
            return new RerankResponse();
        }

        var result = new RerankResponse();
        var seenIds = new HashSet<long>();

        try
        {
            using var doc = JsonDocument.Parse(responseText);
            if (doc.RootElement.TryGetProperty("scores", out var scoresElem) && scoresElem.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in scoresElem.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;

                    // Parse memoryId (supporting both numeric and string-encoded integer representations)
                    if (!item.TryGetProperty("memoryId", out var idElem)) continue;

                    long memId;
                    if (idElem.ValueKind == JsonValueKind.Number && idElem.TryGetInt64(out var idNum))
                    {
                        memId = idNum;
                    }
                    else if (idElem.ValueKind == JsonValueKind.String &&
                             long.TryParse(idElem.GetString(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var idStr))
                    {
                        memId = idStr;
                    }
                    else
                    {
                        continue;
                    }

                    // Prevent duplicate IDs from provider (keep first occurrence)
                    if (!seenIds.Add(memId)) continue;

                    double score = 0.0;
                    if (item.TryGetProperty("score", out var scoreElem) && scoreElem.ValueKind != JsonValueKind.Null)
                    {
                        if (scoreElem.ValueKind == JsonValueKind.Number && scoreElem.TryGetDouble(out var numScore))
                        {
                            score = numScore;
                        }
                        else if (scoreElem.ValueKind == JsonValueKind.String &&
                                 double.TryParse(scoreElem.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var strScore))
                        {
                            score = strScore;
                        }
                        // Non-parseable strings or unexpected value kinds remain default 0.0
                    }

                    // Enforce strict bounding to [0.0, 1.0] and normalize NaN / Infinity to 0.0
                    if (double.IsNaN(score) || double.IsInfinity(score))
                        score = 0.0;
                    else
                        score = Math.Clamp(score, 0.0, 1.0);

                    result.ScoredCandidates.Add(new RerankCandidateScore
                    {
                        MemoryId = memId,
                        RelevanceScore = score
                    });
                }
            }
        }
        catch (JsonException)
        {
            // Malformed JSON returns whatever partial was parsed or empty response
            return result;
        }
        catch (FormatException)
        {
            return result;
        }
        catch (InvalidOperationException)
        {
            return result;
        }

        return result;
    }
}
