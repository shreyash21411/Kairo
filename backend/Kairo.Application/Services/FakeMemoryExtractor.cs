using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class FakeMemoryExtractor : IMemoryExtractor
{
    public Task<List<ExtractedMemory>> ExtractAsync(
        IEnumerable<CreateMessageRequest> messages)
    {
        var memories = new List<ExtractedMemory>
        {
            new()
            {
                Content = "Kairo is an AI memory platform.",
                MemoryType = "ProjectContext"
            }
        };

        return Task.FromResult(memories);
    }
}