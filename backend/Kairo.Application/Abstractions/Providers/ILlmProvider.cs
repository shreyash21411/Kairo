using System.Threading;
using System.Threading.Tasks;

namespace Kairo.Application.Abstractions.Providers;

/// <summary>
/// Phase 4B: Request payload for raw LLM completion calls.
/// Transports prompt text, temperature, and structured output flags without domain-specific schemas.
/// </summary>
public class LlmCompletionRequest
{
    /// <summary>
    /// System instructions establishing persona, extraction rules, or schema boundaries.
    /// </summary>
    public string SystemPrompt { get; set; } = string.Empty;

    /// <summary>
    /// User message content or conversational turn to be processed.
    /// </summary>
    public string UserPrompt { get; set; } = string.Empty;

    /// <summary>
    /// Sampling temperature (typically 0.0 for deterministic extraction, 0.1 for creative synthesis).
    /// </summary>
    public double Temperature { get; set; } = 0.0;

    /// <summary>
    /// When true, instructs the provider to enforce structured JSON output format.
    /// </summary>
    public bool EnforceJsonOutput { get; set; } = true;

    /// <summary>
    /// Optional model override. When null, the provider's default model is used.
    /// </summary>
    public string? Model { get; set; }
}

/// <summary>
/// Phase 4B: Low-level LLM completion provider contract.
/// Centralizes HTTP transport, serialization, cancellation, and response extraction.
/// </summary>
public interface ILlmProvider
{
    /// <summary>
    /// Identifier of the provider implementation (e.g. "Mistral").
    /// </summary>
    string ProviderName { get; }

    /// <summary>
    /// Default model configured for this provider.
    /// </summary>
    string DefaultModel { get; }

    /// <summary>
    /// Executes a chat completion call and returns the extracted message content.
    /// </summary>
    Task<string> GenerateChatCompletionAsync(
        LlmCompletionRequest request,
        CancellationToken cancellationToken = default);
}
