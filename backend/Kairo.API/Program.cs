using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Register Kairo database
builder.Services.AddDbContext<KairoDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("KairoDatabase")
    ));

// Register repositories
builder.Services.AddScoped<IUserRepository, UserRepository>();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();

// HTTPS redirection temporarily disabled
// app.UseHttpsRedirection();

app.Run();