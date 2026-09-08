namespace Kairo.Application.Services;

public class SemanticSimilarityService
{
    public double CalculateCosineSimilarity(
        float[] vectorA,
        float[] vectorB)
    {
        if (vectorA.Length != vectorB.Length)
        {
            throw new ArgumentException(
                "Vectors must have the same dimensions.");
        }

        if (vectorA.Length == 0)
        {
            throw new ArgumentException(
                "Vectors cannot be empty.");
        }

        double dotProduct = 0;
        double magnitudeA = 0;
        double magnitudeB = 0;

        for (var i = 0; i < vectorA.Length; i++)
        {
            dotProduct += vectorA[i] * vectorB[i];

            magnitudeA += vectorA[i] * vectorA[i];

            magnitudeB += vectorB[i] * vectorB[i];
        }

        if (magnitudeA == 0 || magnitudeB == 0)
        {
            throw new ArgumentException(
                "Vectors cannot have zero magnitude.");
        }

        return dotProduct /
               (Math.Sqrt(magnitudeA) * Math.Sqrt(magnitudeB));
    }
}