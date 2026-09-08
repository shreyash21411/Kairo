namespace Kairo.Application.Configuration;

public class MistralOptions
{
    public string ApiKey { get; set; } = null!;

    public string Model { get; set; } = "mistral-small-latest";
}