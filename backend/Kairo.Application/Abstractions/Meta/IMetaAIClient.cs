using System.Threading;
using System.Threading.Tasks;

namespace Kairo.Application.Abstractions.Meta;

/// <summary>
/// Dedicated low-level client for the Meta Model API.
/// This interface is NOT ILlmProvider and must never be registered as one.
/// Accessible only to IMetaMemoryService and IMetaContinuityService implementations.
/// ILlmProvider remains bound exclusively to MistralLlmProvider.
/// </summary>
public interface IMetaAIClient
{
    /// <summary>
    /// Sends a chat completion request to the Meta Model API and returns the response.
    /// Single attempt — no automatic retries.
    /// </summary>
    /// <exception cref="MetaAIExceptions.MetaAIDisabledException">
    /// When MetaAI:Enabled is false. No API call is made.
    /// </exception>
    /// <exception cref="MetaAIExceptions.MetaAIInputTooLargeException">
    /// When the estimated input token count exceeds MaxInputTokenEstimate. No API call is made.
    /// </exception>
    /// <exception cref="MetaAIExceptions.MetaAIAuthException">HTTP 401 or 403.</exception>
    /// <exception cref="MetaAIExceptions.MetaAIRateLimitException">HTTP 429.</exception>
    /// <exception cref="MetaAIExceptions.MetaAIMalformedResponseException">Unparseable response.</exception>
    /// <exception cref="MetaAIExceptions.MetaAIException">Other API or network errors.</exception>
    Task<MetaAIResponse> CompleteAsync(
        MetaAIRequest request,
        CancellationToken cancellationToken = default);
}

