using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Memory Engine operation powered by the Meta Model API.
/// Accepts a raw conversation transcript and returns typed structured project memory.
///
/// This is NOT IMemoryExtractor and does NOT interact with MemoryIngestionService,
/// ILlmProvider, or any Mistral service. The result is returned to the caller —
/// it is never persisted to the database by this service.
///
/// Calls must be explicitly triggered by the user via VoidzoneController.
/// No automatic invocation on captured messages.
/// </summary>
public interface IMetaMemoryService
{
    /// <summary>
    /// Extracts structured project memory from a conversation transcript.
    /// </summary>
    /// <param name="rawTranscript">Full raw transcript text.</param>
    /// <param name="messages">Ordered conversation messages (role + content). Optional.</param>
    /// <param name="cancellationToken">Propagates caller cancellation.</param>
    /// <returns>Structured memory result — not persisted.</returns>
    Task<MetaMemoryResult> ExtractAsync(
        string rawTranscript,
        IReadOnlyList<MetaConversationMessage> messages,
        CancellationToken cancellationToken = default);
}

