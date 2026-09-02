using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Register Kairo database
builder.Services.AddDbContext<KairoDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("KairoDatabase")
    ));

// Add services to the container.
builder.Services.AddOpenApi();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();


// ============================================================
// Database Health Check
// ============================================================

app.MapGet("/api/health/database", async (KairoDbContext db) =>
{
    try
    {
        var canConnect = await db.Database.CanConnectAsync();

        return Results.Ok(new
        {
            database = "SonaliDB",
            connected = canConnect
        });
    }
    catch (Exception ex)
    {
        return Results.Problem(
            title: "Database connection failed",
            detail: ex.Message
        );
    }
})
.WithName("DatabaseHealth");


app.Run();