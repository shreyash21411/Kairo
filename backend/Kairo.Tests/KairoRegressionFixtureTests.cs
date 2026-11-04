using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Meta;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Deterministic regression fixture tests for KAIRO conversation.
/// Validates that project identity, requirements, stack, decisions,
/// constraints, roadmap, and open questions are properly structured and preserved.
/// </summary>
public class KairoRegressionFixtureTests
{
    public const string KairoTranscript = @"User: Hey there man we are going to work on a project called Kairo ? we need to setup the stack first it is for campus peopel where we will use it for events in college to make the bill payments and tickets fast

Assistant: BROOO! 🔥 Let's build KAIRO!

I like this idea. We're going to build something practical for college campuses: a platform where students can discover college events, purchase tickets, make payments, and get instant confirmation.

Before writing code, let's establish the architecture properly. We don't want to build randomly and fix the foundation later.

🚀 Project KAIRO

Campus Events. Tickets. Payments. One Platform.

1. What are we building?
I suggest three major modules.
1. Event Management
Create college events.
Publish event details.
Set ticket prices and availability.
Manage registrations.

2. Ticket Management
Generate unique QR tickets.
Instant ticket confirmation.
Scan tickets at event entrances.
Prevent duplicate ticket usage.

3. Payment Management
Online ticket payments.
UPI, cards and other supported methods.
Payment verification.
Refund and transaction tracking.

2. Recommended technology stack
Frontend — React.js + TypeScript
Backend — Python + FastAPI
Database — PostgreSQL
UI Styling — Tailwind CSS
Payment Gateway — Razorpay
Caching — Redis (later)
Additional backend tools: SQLAlchemy, Alembic, Pydantic, JWT, Swagger/OpenAPI.

3. How the system will work
Important: We will verify payments using the gateway's server-side signature verification and webhooks. We won't trust a frontend success message alone.

5. Our development roadmap
Phase 1: Environment and stack setup
Phase 2: PostgreSQL database design
Phase 3: Authentication APIs
Phase 4: Event management APIs
Phase 5: Ticket booking APIs
Phase 6: Payment gateway integration
Phase 7: QR generation and scanning
Phase 8: Frontend integration
Phase 9: Testing and deployment

6. Before we start coding
I need one architectural decision from you.
1. What should KAIRO initially be?
2. Who will use the platform?
3. Which payment gateway should we start with?

User: yes and give me only the stack names we are using dont define it

Assistant: KAIRO – Technology Stack
Frontend: React.js
Language: TypeScript
Styling: Tailwind CSS
Backend: Python
Framework: FastAPI
Database: PostgreSQL
ORM: SQLAlchemy
Migrations: Alembic
Validation: Pydantic
Authentication: JWT
Payment Gateway: Razorpay
Caching: Redis (later)
API Documentation: Swagger / OpenAPI
Version Control: Git + GitHub
IDE: VS Code
Stack finalized for KAIRO. 🔥";

    private static string BuildKairoMemoryResponseJson() => JsonSerializer.Serialize(new
    {
        projectName = "KAIRO",
        projectPurpose = "Campus event management, ticketing, and payments platform",
        projectDescription = "A platform where college students can discover events, buy tickets, make payments, and get instant QR confirmations.",
        decisions = new[]
        {
            "Finalized technology stack: React.js, TypeScript, Tailwind CSS, Python, FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pydantic, JWT, Razorpay, Swagger/OpenAPI, Git+GitHub, VS Code",
            "Redis designated as a later caching addition rather than immediate requirement",
            "Payment verification must be server-side using signatures and webhooks"
        },
        requirements = new[]
        {
            "Create college events",
            "Publish event information",
            "Set ticket prices and availability",
            "Manage registrations",
            "Generate unique QR tickets",
            "Scan tickets at event entrances",
            "Prevent duplicate ticket usage",
            "Accept online payments (UPI, cards)",
            "Verify payments",
            "Track refunds and transactions"
        },
        constraints = new[]
        {
            "Payment verification must occur server-side using gateway signature verification and webhooks. Frontend success messages must not be trusted as proof of payment.",
            "Redis is a later caching addition, not immediately required for Phase 1."
        },
        goals = new[]
        {
            "Make bill payments and ticket distribution fast and reliable for campus events"
        },
        techStack = new[]
        {
            "React.js", "TypeScript", "Tailwind CSS", "Python", "FastAPI",
            "PostgreSQL", "SQLAlchemy", "Alembic", "Pydantic", "JWT",
            "Razorpay", "Redis (later)", "Swagger / OpenAPI", "Git + GitHub", "VS Code"
        },
        technicalContext = "React + TypeScript + Tailwind frontend; Python + FastAPI + PostgreSQL + SQLAlchemy backend; Razorpay payments; Redis for later caching.",
        architecture = "Three primary modules: Event Management, Ticket Management (QR), Payment Management (server-verified Razorpay).",
        completedWork = Array.Empty<string>(),
        currentProgress = "Stack finalized and architectural roadmap established; ready to resolve open scope questions and begin Phase 1 setup.",
        pendingTasks = new[]
        {
            "Phase 1: Environment and stack setup",
            "Phase 2: PostgreSQL database design",
            "Phase 3: Authentication APIs",
            "Phase 4: Event management APIs",
            "Phase 5: Ticket booking APIs",
            "Phase 6: Payment gateway integration",
            "Phase 7: QR generation and scanning",
            "Phase 8: Frontend integration",
            "Phase 9: Testing and deployment"
        },
        blockers = Array.Empty<string>(),
        dependencies = new[] { "Razorpay account and API keys", "PostgreSQL database instance" },
        nextActions = new[] { "Resolve initial platform scope and user roles", "Initialize repository and environment for FastAPI and React" },
        openQuestions = new[]
        {
            "What should KAIRO initially be (mobile-responsive web vs mobile app)?",
            "Who will use the platform (student roles, organizer roles, admin roles)?"
        },
        entities = new[] { "Event", "Ticket", "Registration", "PaymentOrder", "QRToken", "Transaction" },
        projectFacts = new[] { "Targeted specifically for college campus events" }
    });

    private static string BuildKairoContinuityResponseJson() => JsonSerializer.Serialize(new
    {
        projectName = "KAIRO",
        projectPurpose = "Campus event management, ticketing, and payments platform",
        currentObjective = "Setting up tech stack, architectural boundaries, and development environment for campus event platform",
        importantDecisions = new[]
        {
            "Finalized stack: React.js, TypeScript, Tailwind CSS, Python, FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pydantic, JWT, Razorpay, Swagger/OpenAPI, Git+GitHub, VS Code",
            "Server-side payment verification via webhooks and gateway signature check (never trust frontend alone)"
        },
        proposedDecisions = new[]
        {
            "Three-module architecture: Event Management, Ticket Management, Payment Management"
        },
        openQuestions = new[]
        {
            "Initial platform scope (web vs app)",
            "Detailed user role permissions (student, organizer, admin)"
        },
        confirmedRequirements = new[]
        {
            "Create and publish college events",
            "Manage registrations and ticket pricing",
            "Generate unique QR tickets and scan at entrance",
            "Prevent duplicate ticket use",
            "Accept online payments via Razorpay and track refunds"
        },
        constraints = new[]
        {
            "Server-side signature verification required for payments; never trust frontend success alone",
            "Redis caching is deferred to a later phase"
        },
        completedWork = new[]
        {
            "Technology stack agreed upon and finalized"
        },
        currentProgress = "Architecture outlined and stack agreed upon; awaiting scope clarification before starting Phase 1 setup",
        outstandingTasks = new[]
        {
            "Phase 1: Environment and stack setup",
            "Phase 2: PostgreSQL database design",
            "Phase 3: Authentication APIs",
            "Phase 4: Event management APIs",
            "Phase 5: Ticket booking APIs",
            "Phase 6: Payment gateway integration",
            "Phase 7: QR generation and scanning",
            "Phase 8: Frontend integration",
            "Phase 9: Testing and deployment"
        },
        blockers = Array.Empty<string>(),
        dependencies = new[] { "Razorpay credentials", "PostgreSQL database" },
        recommendedNextAction = "Clarify platform scope and user roles, then begin Phase 1: Environment and stack setup.",
        technicalContext = "Frontend: React.js + TypeScript + Tailwind CSS. Backend: Python + FastAPI + PostgreSQL + SQLAlchemy + Alembic + Pydantic + JWT + Razorpay + Redis (later).",
        conversationContext = "User and assistant discussed KAIRO campus event platform. The assistant proposed a 3-module architecture and 9-phase roadmap, and the user confirmed the tech stack."
    });

    [Fact]
    public async Task KairoMemoryExtraction_PreservesAllRequiredFacts()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock
            .Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MetaAIResponse
            {
                Content = BuildKairoMemoryResponseJson(),
                TokenUsage = new MetaTokenUsage { PromptTokens = 500, CompletionTokens = 350, TotalTokens = 850 }
            });

        var memoryService = new MetaMemoryService(clientMock.Object);

        var result = await memoryService.ExtractAsync(KairoTranscript, new List<MetaConversationMessage>());

        // 1. Project identity & purpose
        Assert.Equal("KAIRO", result.ProjectName);
        Assert.Contains("Campus event management, ticketing, and payments", result.ProjectPurpose);

        // 2. Requirements
        Assert.Contains(result.Requirements, r => r.Contains("Create college events", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Requirements, r => r.Contains("Generate unique QR tickets", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Requirements, r => r.Contains("Scan tickets at event entrances", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Requirements, r => r.Contains("Prevent duplicate ticket usage", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Requirements, r => r.Contains("Accept online payments", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Requirements, r => r.Contains("Verify payments", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Requirements, r => r.Contains("Track refunds", StringComparison.OrdinalIgnoreCase));

        // 3. Tech stack
        Assert.Contains("React.js", result.TechStack);
        Assert.Contains("TypeScript", result.TechStack);
        Assert.Contains("Tailwind CSS", result.TechStack);
        Assert.Contains("Python", result.TechStack);
        Assert.Contains("FastAPI", result.TechStack);
        Assert.Contains("PostgreSQL", result.TechStack);
        Assert.Contains("SQLAlchemy", result.TechStack);
        Assert.Contains("Alembic", result.TechStack);
        Assert.Contains("Pydantic", result.TechStack);
        Assert.Contains("JWT", result.TechStack);
        Assert.Contains("Razorpay", result.TechStack);
        Assert.Contains("Redis (later)", result.TechStack);

        // 4. Important technical constraint
        Assert.Contains(result.Constraints, c => c.Contains("server-side", StringComparison.OrdinalIgnoreCase) && c.Contains("signature verification", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Constraints, c => c.Contains("webhooks", StringComparison.OrdinalIgnoreCase));

        // 5. Roadmap phases
        Assert.Contains(result.PendingTasks, t => t.Contains("Phase 1", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.PendingTasks, t => t.Contains("Phase 2", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.PendingTasks, t => t.Contains("Phase 9", StringComparison.OrdinalIgnoreCase));

        // 6. Open questions preserved (not invented)
        Assert.NotEmpty(result.OpenQuestions);
        Assert.Contains(result.OpenQuestions, q => q.Contains("scope", StringComparison.OrdinalIgnoreCase) || q.Contains("role", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task KairoContinuityGeneration_PreservesAllRequiredContinuityFields()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock
            .Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MetaAIResponse
            {
                Content = BuildKairoContinuityResponseJson(),
                TokenUsage = new MetaTokenUsage { PromptTokens = 550, CompletionTokens = 320, TotalTokens = 870 }
            });

        var continuityService = new MetaContinuityService(clientMock.Object);

        var result = await continuityService.GenerateAsync(KairoTranscript, "chatgpt", "Project Kairo stack discussion");

        // Project identity & objective
        Assert.Equal("KAIRO", result.ProjectName);
        Assert.Contains("Campus event management", result.ProjectPurpose);
        Assert.Contains("Setting up tech stack", result.CurrentObjective);

        // Confirmed decisions vs proposed
        Assert.Contains(result.ImportantDecisions, d => d.Contains("Finalized stack", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.ProposedDecisions, p => p.Contains("Three-module architecture", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.OpenQuestions, q => q.Contains("scope", StringComparison.OrdinalIgnoreCase));

        // Requirements and constraints
        Assert.NotEmpty(result.ConfirmedRequirements);
        Assert.Contains(result.Constraints, c => c.Contains("server-side signature verification", StringComparison.OrdinalIgnoreCase));

        // Recommended next action is contextual and non-generic
        Assert.Contains("Clarify platform scope", result.RecommendedNextAction);
        Assert.DoesNotContain("Review outstanding tasks", result.RecommendedNextAction);
        Assert.DoesNotContain("Continue active session", result.RecommendedNextAction);

        // Technical context is rich
        Assert.Contains("FastAPI", result.TechnicalContext);
        Assert.Contains("PostgreSQL", result.TechnicalContext);
        Assert.Contains("Razorpay", result.TechnicalContext);
    }
}
