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
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Kairo.Application.Abstractions.Authentication;
using Kairo.Infrastructure.Security;
using Kairo.Application.Security;
using Microsoft.OpenApi;
using Kairo.MCP.Extensions; // Phase 9: MCP adapter layer
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;


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

// ── Account / Human Authentication (AUTH-8) ─────────────────────────────────
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IAuthenticationIdentityRepository, AuthenticationIdentityRepository>();
builder.Services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
builder.Services.AddScoped<IPasswordHasher, PasswordHasher>();
builder.Services.AddScoped<ITransactionCoordinator, EfTransactionCoordinator>();
builder.Services.AddScoped<ITokenService, TokenService>();
builder.Services.AddScoped<AccountContext>();
builder.Services.AddScoped<IAccountContext>(sp =>
    sp.GetRequiredService<AccountContext>());
builder.Services.AddScoped<IAccountService, AccountService>();

// ── Rate Limiting (AUTH-9G) ──────────────────────────────────
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.ContentType = "application/json";
        await context.HttpContext.Response.WriteAsync(
            "{\"message\":\"Too many requests. Please try again later.\"}",
            token);
    };
    options.AddPolicy("auth-policy", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
});

// Authentication: KairoApiKey (default scheme) + KairoJwt (named scheme)
var jwtSigningKey = builder.Configuration["Kairo:Jwt:SigningKey"];

builder.Services
    .AddAuthentication("KairoApiKey")
    .AddScheme<AuthenticationSchemeOptions, KairoApiKeyAuthenticationHandler>(
        "KairoApiKey",
        options => { })
    .AddJwtBearer("KairoJwt", options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = !string.IsNullOrEmpty(jwtSigningKey)
                ? new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSigningKey))
                : null,
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            ValidAlgorithms = new[] { SecurityAlgorithms.HmacSha256 }
        };
    });

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


// ── Phase 9: MCP Integration Layer ────────────────────────────────────────
// Registers the MCP server (Streamable HTTP transport) and discovers Kairo
// MCP tools from Kairo.MCP. The existing IMemoryService, IApiKeyContext, and
// KairoApiKeyAuthenticationHandler registrations above are reused as-is.
// No duplicate memory logic, repositories, or auth is introduced here.
builder.Services.AddKairoMcp();


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


if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseRateLimiter();


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


// ── Phase 9: MCP endpoint ─────────────────────────────────────────────────
// MapMcp returns a RouteGroupBuilder. RequireAuthorization() ensures the
// existing KairoApiKeyAuthenticationHandler runs before any MCP tool.
// The scoped ApiKeyContext is populated by the auth handler — the same
// mechanism used by MemoryController. No new auth logic is introduced.
app.MapMcp("/mcp")
   .RequireAuthorization();


app.Run();
