namespace Kairo.Application.Abstractions.Services;

public interface IEmbeddingGenerator
{
    Task<float[]> GenerateAsync(string text);
}