namespace Kairo.Application.DTOs;

public class EmbeddingBackfillResult
{
    public long UserId { get; set; }

    public int MemoriesAnalyzed { get; set; }

    public int EmbeddingsAlreadyPresent { get; set; }

    public int EmbeddingsGenerated { get; set; }

    public int EmbeddingFailures { get; set; }

    public List<EmbeddingBackfillFailure> Failures { get; set; } = new();
}

public class EmbeddingBackfillFailure
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string ErrorMessage { get; set; } = null!;
}
