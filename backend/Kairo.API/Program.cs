using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Services;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Services;
using Microsoft.Extensions.Options;
using Kairo.Application.Abstractions.Security;
using Kairo.API.Security;
using Kairo.API.Authentication;
using Microsoft.AspNetCore.Authentication;
using Kairo.Application.Security;
using Microsoft.OpenApi;


var builder = WebApplication.CreateBuilder(args);

// Register Kairo database
builder.Services.AddDbContext<KairoDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("KairoDatabase")
    ));

// Register repositories
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IUserService, UserService>();

builder.Services.AddScoped<IChatRepository, ChatRepository>();
builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddScoped<IChatProcessingService, ChatProcessingService>();
builder.Services.AddScoped<IMemoryConsolidationService, MemoryConsolidationService>();

builder.Services.AddScoped<IMemoryRepository, MemoryRepository>();

// API Key services
builder.Services.AddScoped<IApiKeyService, ApiKeyService>();
builder.Services.AddScoped<IApiKeyRepository, ApiKeyRepository>();

// API Key authentication context
builder.Services.AddScoped<ApiKeyContext>();
builder.Services.AddScoped<IApiKeyContext>(sp =>
    sp.GetRequiredService<ApiKeyContext>());

builder.Services.AddScoped<IApiKeyValidator, ApiKeyValidator>();

// API Key authentication
builder.Services
    .AddAuthentication("KairoApiKey")
    .AddScheme<AuthenticationSchemeOptions, KairoApiKeyAuthenticationHandler>(
        "KairoApiKey",
        options => { });

builder.Services.AddAuthorization();

// Project services
builder.Services.AddScoped<IProjectRepository, ProjectRepository>();
builder.Services.AddScoped<IProjectService, ProjectService>();

builder.Services.Configure<MistralOptions>(
    builder.Configuration.GetSection("Mistral"));

builder.Services.AddHttpClient<IMemoryExtractor, MistralMemoryExtractor>();

builder.Services.Configure<MistralEmbeddingOptions>(
    builder.Configuration.GetSection("MistralEmbedding"));

builder.Services.AddHttpClient<
    IEmbeddingGenerator,
    MistralEmbeddingGenerator>();

builder.Services.AddHttpClient<
    IMemoryRelevanceEvaluator,
    MistralMemoryRelevanceEvaluator>();

builder.Services.AddScoped<SemanticSimilarityService>();
builder.Services.AddScoped<MemoryRetrievalService>();

// ── V1 Public Memory API ────────────────────────────────────────────────────
builder.Services.AddScoped<IMemoryService, MemoryService>();

// ── Phase A: Embedding Backfill (Task 1) ──────────────────────────────────
builder.Services.AddScoped<IEmbeddingBackfillService, EmbeddingBackfillService>();

// ── Phase A: Mistral Consolidation Evaluator (Task 3) ────────────────────
builder.Services.AddHttpClient<
    IMemoryConsolidationEvaluator,
    MistralMemoryConsolidationEvaluator>();

// ── Phase A: Full Consolidation Pipeline (Tasks 3+4) ─────────────────────
builder.Services.AddScoped<IFullConsolidationService, FullConsolidationService>();


// Add services to the container
builder.Services.AddControllers();

builder.Services.AddOpenApi();


// ── Swagger ──────────────────────────────────────────────────────────────────
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition(
        "KairoApiKey",
        new OpenApiSecurityScheme
        {
            Name = "Authorization",
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "API Key",
            In = ParameterLocation.Header,
            Description = "Enter your Kairo API key."
        });

    options.AddSecurityRequirement(document =>
        new OpenApiSecurityRequirement
        {
            [
                new OpenApiSecuritySchemeReference(
                    "KairoApiKey",
                    document)
            ] = []
        });
});


var app = builder.Build();


// ── Security headers ──────────────────────────────────────────────────────────
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["X-XSS-Protection"] = "0";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});


// Authentication must run before Authorization
app.UseAuthentication();

app.UseAuthorization();


// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();

    app.UseSwagger();

    app.UseSwaggerUI();
}


app.MapControllers();


// HTTPS redirection temporarily disabled
// app.UseHttpsRedirection();


app.Run();