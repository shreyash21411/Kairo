using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IMemoryConsolidationService
{
    Task<MemoryConsolidationResult> ConsolidateAsync(
        MemoryConsolidationRequest request,
        long? scopeId = null);
}