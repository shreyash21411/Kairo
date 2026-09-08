namespace Kairo.Application.DTOs;

public class MemoryRetrievalRequest
{
    public string Query { get; set; } = null!;

    public int TopK { get; set; } = 5;
}

public class RetrievedMemory
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    public double Similarity { get; set; }
}
