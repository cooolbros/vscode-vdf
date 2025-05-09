using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

WebApplicationBuilder builder = WebApplication.CreateSlimBuilder(args);

builder.Services.AddCors((options) =>
{
	options.AddDefaultPolicy((policy) => policy.AllowAnyOrigin());
});

builder.Services.AddScoped((sp) =>
{
	SqliteConnection connection = new("Data Source=tf.db; Mode=ReadOnly");
	connection.Open();
	return connection;
});

WebApplication app = builder.Build();

app.UseCors();

JsonSerializerOptions options = new()
{
	Converters = { new Converter() },
	TypeInfoResolver = AppJsonSerializerContext.Default,
	PropertyNamingPolicy = new LowerCaseNamingPolicy(),
};

app.Use((context, next) =>
{
	context.Response.Headers.CacheControl = new CacheControlHeaderValue
	{
		Public = true,
		MaxAge = TimeSpan.FromDays(30)
	}.ToString();

	return next();
});

app.MapGet("{**path}", (HttpRequest request, HttpResponse response, SqliteConnection connection, string path = "") =>
{
	path = Path.TrimEndingDirectorySeparator(path).ToLower();

	if (request.Query.ContainsKey("stat"))
	{
		if (path == "")
		{
			long time = UserVersion(connection);
			return Results.Json(new FileStat
			{
				Type = FileType.Directory,
				CTime = time,
				MTime = time,
				Size = 0,
				Permissions = FilePermission.Readonly
			}, options);
		}

		using SqliteCommand command = connection.CreateCommand();
		command.CommandText = """
			SELECT
				CASE WHEN "name" = $path THEN "bytes" ELSE 0 END AS "size"
			FROM "tf"
			WHERE "tf"."name" = $path OR "tf"."name" LIKE $path || '/%'
			LIMIT 1;
		""";
		command.Parameters.AddWithValue("$path", path);

		using SqliteDataReader reader = command.ExecuteReader(CommandBehavior.SingleRow);
		if (reader.Read())
		{
			int size = reader.GetInt32("size");
			long time = UserVersion(connection);
			return Results.Json(new FileStat
			{
				Type = size == 0 ? FileType.Directory : FileType.File,
				CTime = time,
				MTime = time,
				Size = size,
				Permissions = FilePermission.Readonly
			}, options);
		}
		else
		{
			return Results.NotFound();
		}
	}
	else if (request.Query.ContainsKey("readdir"))
	{
		using SqliteCommand command = connection.CreateCommand();
		command.CommandText = $"""
			SELECT
			DISTINCT
				SUBSTRING("name", 0, CASE WHEN INSTR("name", '/') > 0 THEN INSTR("name", '/') ELSE LENGTH("name") + 1 END) AS "name",
				CASE WHEN INSTR("name", '/') > 0 THEN 2 ELSE 1 END AS "type"
			FROM {(path.Length > 0 ? """(SELECT SUBSTRING("name", $length + 2) AS "name" FROM "tf" WHERE "name" LIKE $path || '/%')""" : "\"tf\"")}
			ORDER BY "type" DESC, "name" ASC;
		""";

		command.Parameters.AddWithValue("$path", path);
		command.Parameters.AddWithValue("$length", path.Length);

		using SqliteDataReader reader = command.ExecuteReader();
		if (reader.HasRows)
		{
			List<(string, byte)> folder = [];
			while (reader.Read())
			{
				folder.Add((reader.GetString("name"), reader.GetByte("type")));
			}

			return Results.Json(folder.ToArray(), options);
		}
		else
		{
			if (TryGetFile(connection, path, out int? bytes, out Stream? data))
			{
				return Results.StatusCode((int)HttpStatusCode.UnsupportedMediaType);
			}
			else
			{
				return Results.NotFound();
			}
		}
	}
	else
	{
		if (TryGetFile(connection, path, out int? bytes, out Stream? data))
		{
			response.Headers.ContentLength = bytes;
			response.Headers.ContentType = "application/octet-stream";
			return Results.Stream(new BrotliStream(data, CompressionMode.Decompress));
		}
		else
		{
			using SqliteCommand command = connection.CreateCommand();
			command.CommandText = """
				SELECT
					NULL
				FROM "tf"
				WHERE "name" LIKE $path || '/%'
				LIMIT 1;
			""";
			command.Parameters.AddWithValue("$path", path);

			using SqliteDataReader reader = command.ExecuteReader(CommandBehavior.SingleRow);
			if (reader.HasRows)
			{
				return Results.StatusCode((int)HttpStatusCode.UnsupportedMediaType);
			}
			else
			{
				return path switch
				{
					"" => Results.Text(File.ReadAllText("README.md"), contentType: "text/markdown"),
					"favicon.ico" => Results.Redirect("https://raw.githubusercontent.com/cooolbros/vscode-vdf/main/icon.png"),
					_ => Results.NotFound()
				};
			}
		}
	}
});

app.Run();

static bool TryGetFile(SqliteConnection connection, string path, [NotNullWhen(true)] out int? bytes, [NotNullWhen(true)] out Stream? data)
{
	using SqliteCommand command = connection.CreateCommand();
	command.CommandText = """
		SELECT
			"bytes",
			"data"
		FROM "tf"
		WHERE "name" = $path
		LIMIT 1;
	""";
	command.Parameters.AddWithValue("$path", path);

	using SqliteDataReader reader = command.ExecuteReader(CommandBehavior.SingleRow | CommandBehavior.SequentialAccess);
	if (reader.Read())
	{
		bytes = reader.GetInt32("bytes");
		data = reader.GetStream("data");
		return true;
	}
	else
	{
		bytes = null;
		data = null;
		return false;
	}
}

static long UserVersion(SqliteConnection connection)
{
	using SqliteCommand command = connection.CreateCommand();
	command.CommandText = "PRAGMA user_version;";
	return DateTimeOffset.FromUnixTimeSeconds((long)command.ExecuteScalar()!).ToUnixTimeMilliseconds();
}

record class FileStat
{
	public required FileType Type { get; init; }
	public required long CTime { get; init; }
	public required long MTime { get; init; }
	public required int Size { get; init; }
	public required FilePermission Permissions { get; init; }
}

enum FileType : byte
{
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

enum FilePermission : byte
{
	Readonly = 1,
}

[JsonSerializable(typeof(FileStat))]
[JsonSerializable(typeof((string, byte)[]))]
partial class AppJsonSerializerContext : JsonSerializerContext
{
}

class Converter : JsonConverter<(string, byte)>
{
	public override (string, byte) Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
		throw new NotImplementedException();
	}

	public override void Write(Utf8JsonWriter writer, (string, byte) value, JsonSerializerOptions options)
	{
		writer.WriteStartArray();
		writer.WriteStringValue(value.Item1);
		writer.WriteNumberValue(value.Item2);
		writer.WriteEndArray();
	}
}

class LowerCaseNamingPolicy : JsonNamingPolicy
{
	public override string ConvertName(string name) => name.ToLower();
}
