using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IMemoryExtractor
{
    Task<List<ExtractedMemory>> ExtractAsync(
        IEnumerable<CreateMessageRequest> messages);
}