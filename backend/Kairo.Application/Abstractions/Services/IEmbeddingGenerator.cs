using System.Threading;
using System.Threading.Tasks;

namespace Kairo.Application.Abstractions.Services;

public interface IEmbeddingGenerator
{
    Task<float[]> GenerateAsync(string text, CancellationToken cancellationToken = default);
}