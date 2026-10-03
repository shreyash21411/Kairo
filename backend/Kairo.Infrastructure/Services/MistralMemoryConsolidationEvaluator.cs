using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

public class MistralMemoryConsolidationEvaluator : IMemoryConsolidationEvaluator
{
    private readonly HttpClient _httpClient;
    private readonly MistralOptions _options;

    public MistralMemoryConsolidationEvaluator(
        HttpClient httpClient,
        IOptions<MistralOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public async Task<ConsolidationEvaluationResult> EvaluateAsync(
        MemoryConsolidationCandidate candidate)
    {
        var userContent = JsonSerializer.Serialize(new
        {
            existingMemory = candidate.ContentA,
            newCandidate   = candidate.ContentB
        });

        var requestBody = new
        {
            model = _options.Model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content =
                        """
                        You are Kairo's memory intelligence and consolidation engine.
                        Your task is to analyze an EXISTING memory (existingMemory) against a NEW candidate memory (newCandidate) and decide how the knowledge should be handled.

                        Determine which of the following 4 actions applies:

                        1. "NoAction":
                           The newCandidate conveys the exact same fact or preference as existingMemory without adding any new or meaningful details. No update is needed.
                           canonicalContent: null

                        2. "Merge":
                           The newCandidate and existingMemory describe the SAME core fact or preference, but one provides additional context, detail, or clarification that complements the other. They should be combined into a single, concise canonical statement.
                           canonicalContent: A single concise statement capturing the combined knowledge.

                        3. "Update":
                           The newCandidate SUPERSEDES, CONTRADICTS, or REPLACES the existingMemory (e.g. user moved to a new city, changed jobs, or explicitly changed their preference to a new exclusive choice). The existing memory is out-of-date and should be replaced.
                           canonicalContent: The new current fact/preference that supersedes the old one.

                        4. "Add":
                           The newCandidate represents a DIFFERENT, INDEPENDENT, or COMPATIBLE fact (e.g. using multiple technologies like PostgreSQL and Redis, or facts from different domains). Both memories should exist independently.
                           canonicalContent: null

                        CRITICAL RULES:
                        - If newCandidate and existingMemory are compatible items (e.g., "I use PostgreSQL" and "I use Redis"), choose "Add". They do NOT contradict unless the user explicitly switches or states an exclusive preference.
                        - If newCandidate directly contradicts or updates a previous status (e.g., "moved from X to Y", "now work at Y", "switched to Y"), choose "Update".
                        - Never invent information not present in either memory.
                        - Be precise and conservative.

                        Return ONLY a JSON object with this exact structure:
                        {
                          "action": "NoAction" | "Merge" | "Update" | "Add",
                          "canonicalContent": "string or null",
                          "reason": "Brief explanation for this decision"
                        }
                        """
                },
                new
                {
                    role = "user",
                    content = userContent
                }
            }
        };

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/chat/completions");

        httpRequest.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        var json = JsonSerializer.Serialize(requestBody);

        httpRequest.Content = new StringContent(
            json,
            Encoding.UTF8,
            "application/json");

        using var response = await _httpClient.SendAsync(httpRequest);

        var responseContent =
            await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Mistral consolidation evaluation failed. " +
                $"Status: {(int)response.StatusCode}. " +
                $"Response: {responseContent}");
        }

        using var document = JsonDocument.Parse(responseContent);

        var messageContent =
            document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

        if (string.IsNullOrWhiteSpace(messageContent))
        {
            return FailSafe("Empty response from Mistral evaluator.");
        }

        try
        {
            using var resultDocument = JsonDocument.Parse(messageContent);
            var root = resultDocument.RootElement;

            string? reason = null;
            if (root.TryGetProperty("reason", out var reasonEl) &&
                reasonEl.ValueKind == JsonValueKind.String)
            {
                reason = reasonEl.GetString();
            }

            string? canonicalContent = null;
            if (root.TryGetProperty("canonicalContent", out var canonicalEl) &&
                canonicalEl.ValueKind == JsonValueKind.String)
            {
                canonicalContent = canonicalEl.GetString();
            }

            // Phase 3 4-action schema check: "action" property
            if (root.TryGetProperty("action", out var actionEl) &&
                actionEl.ValueKind == JsonValueKind.String)
            {
                var actionStr = actionEl.GetString()?.Trim();

                if (string.Equals(actionStr, "NoAction", StringComparison.OrdinalIgnoreCase))
                {
                    return new ConsolidationEvaluationResult
                    {
                        Action = ConsolidationAction.NoAction,
                        CanonicalContent = null,
                        Reason = reason
                    };
                }

                if (string.Equals(actionStr, "Merge", StringComparison.OrdinalIgnoreCase))
                {
                    if (string.IsNullOrWhiteSpace(canonicalContent))
                    {
                        // Fall back to candidate content rather than discarding knowledge
                        canonicalContent = candidate.ContentB;
                    }

                    return new ConsolidationEvaluationResult
                    {
                        Action = ConsolidationAction.Merge,
                        CanonicalContent = canonicalContent,
                        Reason = reason
                    };
                }

                if (string.Equals(actionStr, "Update", StringComparison.OrdinalIgnoreCase))
                {
                    if (string.IsNullOrWhiteSpace(canonicalContent))
                    {
                        canonicalContent = candidate.ContentB;
                    }

                    return new ConsolidationEvaluationResult
                    {
                        Action = ConsolidationAction.Update,
                        CanonicalContent = canonicalContent,
                        Reason = reason
                    };
                }

                if (string.Equals(actionStr, "Add", StringComparison.OrdinalIgnoreCase))
                {
                    return new ConsolidationEvaluationResult
                    {
                        Action = ConsolidationAction.Add,
                        CanonicalContent = null,
                        Reason = reason
                    };
                }
            }

            // Backward compatibility fallback: check for legacy isSameKnowledge boolean
            if (root.TryGetProperty("isSameKnowledge", out var sameKnowledgeEl))
            {
                var isSameKnowledge = sameKnowledgeEl.ValueKind == JsonValueKind.True;

                if (isSameKnowledge && !string.IsNullOrWhiteSpace(canonicalContent))
                {
                    return new ConsolidationEvaluationResult
                    {
                        Action = ConsolidationAction.Merge,
                        CanonicalContent = canonicalContent,
                        Reason = reason
                    };
                }

                return new ConsolidationEvaluationResult
                {
                    Action = ConsolidationAction.Add,
                    CanonicalContent = null,
                    Reason = reason
                };
            }

            return FailSafe("Response missing recognized action field. Failing safe to Add.");
        }
        catch (JsonException ex)
        {
            return FailSafe(
                $"Malformed JSON from Mistral evaluator: {ex.Message}");
        }
    }

    private static ConsolidationEvaluationResult FailSafe(string reason)
    {
        return new ConsolidationEvaluationResult
        {
            Action = ConsolidationAction.Add,
            CanonicalContent = null,
            Reason = reason
        };
    }
}
