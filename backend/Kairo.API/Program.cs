using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Services;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Services;
using Kairo.Infrastructure.Providers;
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
using Kairo.API.Configuration;
using Kairo.API.Middleware; // Phase 5.8
using System.Diagnostics.Metrics; // Phase 5.8.4
using Kairo.API.Health;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using System.Net;


var builder = WebApplication.CreateBuilder(args);

// ── Phase 4C: Fail-Fast Provider Discovery & Startup Validation ──────────────
var providerSettings = ProviderConfigurationValidator.Validate(builder.Configuration);

// Register Kairo database (conditional SQL Server default or PostgreSQL with pgvector)
builder.Services.AddKairoDatabase(providerSettings);

// Register repositories
builder.Services.AddScoped<IUserRepository, UserRepository>();

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

// ── Phase 10.2: Scope Resolution Layer ────────────────────────────────────────
builder.Services.AddScoped<IMemoryScopeRepository, MemoryScopeRepository>();
builder.Services.AddScoped<IScopeResolutionService, ScopeResolutionService>();

// Health check service registration (Liveness + PostgreSQL readiness)
builder.Services.AddHealthChecks()
    .AddCheck<KairoDatabaseHealthCheck>("postgresql", tags: new[] { "ready" });

// ── Forwarded Headers ─────────────────────────────────────────────────────
// SECURITY NOTE: ForwardedHeaders:TrustAllNetworks must never be enabled in
// production. It clears all known-proxy lists, allowing any client to spoof
// X-Forwarded-For/Proto. Use KnownProxies or KnownNetworks with exact IPs.
// Deployment operators must configure their actual load-balancer addresses.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

    var forwardedConfig = builder.Configuration.GetSection("ForwardedHeaders");

    // Validate ForwardLimit before applying it — reject ≤0 values at startup.
    var forwardLimit = forwardedConfig.GetValue<int?>("ForwardLimit");
    if (forwardLimit.HasValue)
    {
        if (forwardLimit.Value <= 0)
        {
            throw new InvalidOperationException(
                $"ForwardedHeaders:ForwardLimit must be a positive integer. Got: {forwardLimit.Value}. " +
                "Set it to 1 (single proxy) or higher. The default is 1.");
        }
        options.ForwardLimit = forwardLimit.Value;
    }

    var trustAll = forwardedConfig.GetValue<bool>("TrustAllNetworks", false);
    if (trustAll)
    {
        // WARNING: TrustAllNetworks disables all IP filtering. For local development only.
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
    }
    else
    {
        var knownProxies = forwardedConfig.GetSection("KnownProxies").Get<string[]>() ?? Array.Empty<string>();
        foreach (var proxy in knownProxies)
        {
            if (IPAddress.TryParse(proxy, out var ip))
            {
                options.KnownProxies.Add(ip);
            }
        }

        var knownNetworks = forwardedConfig.GetSection("KnownNetworks").Get<string[]>() ?? Array.Empty<string>();
        foreach (var network in knownNetworks)
        {
            if (System.Net.IPNetwork.TryParse(network, out var ipNet))
            {
                options.KnownIPNetworks.Add(ipNet);
            }
        }
    }
});

// ── Phase 4B: Provider Abstraction Layer ──────────────────────────────────────
builder.Services.Configure<ProviderOptions>(
    builder.Configuration.GetSection(ProviderOptions.SectionName));
builder.Services.Configure<MistralOptions>(
    builder.Configuration.GetSection("Mistral"));
builder.Services.Configure<MistralEmbeddingOptions>(
    builder.Configuration.GetSection("MistralEmbedding"));

// Concrete HTTP provider registrations
builder.Services.AddHttpClient<MistralLlmProvider>();
builder.Services.AddHttpClient<MistralEmbeddingProvider>();

// Active provider abstraction bindings (validated upfront by ProviderConfigurationValidator)
builder.Services.AddScoped<ILlmProvider>(sp => sp.GetRequiredService<MistralLlmProvider>());
builder.Services.AddScoped<IEmbeddingProvider>(sp => sp.GetRequiredService<MistralEmbeddingProvider>());

// High-level service adapters delegating to providers (explicit factories prevent DI constructor ambiguity)
builder.Services.AddScoped<IEmbeddingGenerator>(sp => new MistralEmbeddingGenerator(sp.GetRequiredService<IEmbeddingProvider>()));
builder.Services.AddScoped<IMemoryExtractor>(sp => new MistralMemoryExtractor(sp.GetRequiredService<ILlmProvider>()));
builder.Services.AddScoped<IMemoryRelevanceEvaluator>(sp => new MistralMemoryRelevanceEvaluator(sp.GetRequiredService<ILlmProvider>()));
builder.Services.AddScoped<IMemoryConsolidationEvaluator>(sp => new MistralMemoryConsolidationEvaluator(sp.GetRequiredService<ILlmProvider>()));
builder.Services.AddScoped<IEntityExtractionService>(sp => new MistralEntityExtractionService(
    sp.GetRequiredService<ILlmProvider>(),
    sp.GetRequiredService<ILogger<MistralEntityExtractionService>>()));

builder.Services.AddScoped<SemanticSimilarityService>();
builder.Services.AddScoped<MemoryRetrievalService>();

// ── Phase 5.6: Dedicated Reranker Layer ───────────────────────────────────────
builder.Services.Configure<RerankerOptions>(
    builder.Configuration.GetSection(RerankerOptions.SectionName));
builder.Services.AddScoped<IRerankProvider, MistralLlmRerankProvider>();
builder.Services.AddScoped<IRerankerService, RerankerService>();

// ── V1 Public Memory API ────────────────────────────────────────────────────
builder.Services.AddScoped<IMemoryService, MemoryService>();

// ── Phase 2: Conversational Memory Ingestion ──────────────────────────────
builder.Services.AddScoped<IMemoryIngestionService, MemoryIngestionService>();

// ── Phase A: Embedding Backfill (Task 1) ──────────────────────────────────
builder.Services.AddScoped<IEmbeddingBackfillService, EmbeddingBackfillService>();

// ── Phase A: Full Consolidation Pipeline (Tasks 3+4) ─────────────────────
builder.Services.AddScoped<IFullConsolidationService, FullConsolidationService>();

// ── Phase 1 (V2): Multi-dimensional scopes + Entity extraction + Hybrid retrieval ──
builder.Services.AddScoped<IEntityRepository, EntityRepository>();
builder.Services.AddScoped<IKeywordSearchRepository, KeywordSearchRepository>();
builder.Services.AddScoped<HybridRetrievalService>();

// ── Phase 4A: Async Ingestion & Background Job Worker ─────────────────────
builder.Services.AddScoped<IIngestionJobRepository, IngestionJobRepository>();
builder.Services.AddScoped<IMemoryJobService, MemoryJobService>();
builder.Services.AddHostedService<Kairo.API.Services.MemoryIngestionWorker>();


// ── Phase 9: MCP Integration Layer ────────────────────────────────────────
// Registers the MCP server (Streamable HTTP transport) and discovers Kairo
// MCP tools from Kairo.MCP. The existing IMemoryService, IApiKeyContext, and
// KairoApiKeyAuthenticationHandler registrations above are reused as-is.
// No duplicate memory logic, repositories, or auth is introduced here.
builder.Services.AddKairoMcp();

// ── Phase 5.8: Usage Metering, Quota, and Reporting ───────────────────────
builder.Services.Configure<Kairo.Application.Configuration.QuotaOptions>(
    builder.Configuration.GetSection(Kairo.Application.Configuration.QuotaOptions.SectionName));
builder.Services.AddScoped<IUsageMeterService>(sp => new UsageMeterService(
    sp.GetRequiredService<IServiceScopeFactory>(),
    sp.GetRequiredService<ILogger<UsageMeterService>>(),
    sp.GetService<IQuotaEnforcementService>()));
builder.Services.AddScoped<IQuotaEnforcementService, QuotaEnforcementService>();
builder.Services.AddScoped<IUsageReportingService, UsageReportingService>();

// Phase 5.8.4: Kairo.Platform meter (System.Diagnostics.Metrics)
// A singleton Meter is the correct lifetime — meters are static/process-scoped.
builder.Services.AddSingleton(sp =>
{
    var meter = new Meter("Kairo.Platform", "1.0.0");
    return meter;
});


// Add services to the container
builder.Services.AddControllers()
    .AddJsonOptions(opts =>
        opts.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter()));

// ── ProblemDetails (AUTH-9L) ──────────────────────────────────────────────────
// Enables RFC 7807 / RFC 9457 structured error responses.
// UseExceptionHandler below will write a generic HTTP 500 problem response
// for any unhandled exception without leaking implementation details.
builder.Services.AddProblemDetails();

// ── CORS (AUTH-9M) ────────────────────────────────────────────────────────────
// Origins are read exclusively from configuration so that no production domain
// is hardcoded here. Set Kairo:Cors:AllowedOrigins in the environment-specific
// appsettings or environment variables before deploying.
//
// Explicit restrictions (do NOT relax without a security review):
//   - No AllowAnyOrigin()      — exact origin list only
//   - No AllowAnyMethod()      — GET, POST, PUT, PATCH, DELETE, OPTIONS only
//   - No AllowAnyHeader()      — Content-Type, Authorization, Accept only
//   - No AllowCredentials()    — Kairo uses JWT Bearer / API-key headers;
//                                cookies are not part of the auth model
var allowedOrigins = builder.Configuration
    .GetSection("Kairo:Cors:AllowedOrigins")
    .Get<string[]>() ?? Array.Empty<string>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("KairoCors", policy =>
    {
        if (allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins)
                  .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                  .WithHeaders("Content-Type", "Authorization", "Accept");
        }
        // If AllowedOrigins is empty the policy permits no origins, which is
        // the safe default. No requests will be cross-origin-allowed until
        // the configuration is explicitly populated.
    });
});

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
    context.Response.Headers["Permissions-Policy"] =
        "geolocation=(), camera=(), microphone=()";

    var isDevelopmentSwagger =
        app.Environment.IsDevelopment() &&
        context.Request.Path.StartsWithSegments("/swagger");

    if (!isDevelopmentSwagger)
    {
        context.Response.Headers["Content-Security-Policy"] =
            "default-src 'none'; frame-ancestors 'none'";
    }

    await next();
});



// ── Global exception handler (AUTH-9L) ────────────────────────────────────────
// Must be registered first in the pipeline so it can catch exceptions from all
// subsequent middleware and controllers.
// Produces a safe generic HTTP 500 application/problem+json body with no stack
// trace, no exception message, and no internal details.
app.UseExceptionHandler(errApp =>
{
    errApp.Run(async context =>
    {
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        var problemDetails = context.RequestServices
            .GetRequiredService<IProblemDetailsService>();
        await problemDetails.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Status = StatusCodes.Status500InternalServerError,
                Title  = "An unexpected error occurred."
            }
        });
    });
});


// ── Forwarded Headers (AUTH-PROXY) ──────────────────────────────────────────
// Must execute at the very top of the pipeline before HTTPS redirection, CORS, and rate limiting
app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// ── CORS (AUTH-9M) ───────────────────────────────────────────────────────────
// Must run after HTTPS redirection and before rate limiting / authentication
// so that browsers receive CORS headers on both preflight and actual requests.
app.UseCors("KairoCors");

app.UseRateLimiter();

// Authentication must run before Authorization
app.UseAuthentication();

app.UseAuthorization();

// ── Phase 5.8.3: Quota enforcement ────────────────────────────────────────
// Runs after authentication and authorization so ApiKeyContext is populated,
// and unauthorized requests are already rejected, but before
// controllers and MCP tools so memory operations are gated on quota.
app.UseMiddleware<QuotaMeterMiddleware>();


// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();

    app.UseSwagger();

    app.UseSwaggerUI();
}


app.MapControllers();

// Health check endpoints for hosting orchestrator (Render, Docker, Kubernetes)
// 1. Process liveness probe: returns 200 if process is up and serving requests
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false
}).AllowAnonymous();

// 2. Database readiness probe: returns 200 if PostgreSQL is reachable, 503 if unreachable
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
}).AllowAnonymous();

// 3. Composite health endpoint: runs all checks (including database readiness) for default probes
app.MapHealthChecks("/health", new HealthCheckOptions()).AllowAnonymous();


// ── Phase 9: MCP endpoint ─────────────────────────────────────────────────
// MapMcp returns a RouteGroupBuilder. RequireAuthorization() ensures the
// existing KairoApiKeyAuthenticationHandler runs before any MCP tool.
// The scoped ApiKeyContext is populated by the auth handler — the same
// mechanism used by MemoryController. No new auth logic is introduced.
app.MapMcp("/mcp")
   .RequireAuthorization();


app.Run();
