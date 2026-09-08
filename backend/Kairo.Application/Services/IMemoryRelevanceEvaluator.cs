using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IMemoryRelevanceEvaluator
{
    Task<List<RetrievedMemory>> EvaluateAsync(
        string query,
        List<RetrievedMemory> candidates);
}