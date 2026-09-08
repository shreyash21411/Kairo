namespace Kairo.Application.Configuration;

public class MistralEmbeddingOptions
{
    public string ApiKey { get; set; } = null!;
    public string Model { get; set; } = "mistral-embed";
}