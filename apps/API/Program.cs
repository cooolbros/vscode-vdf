using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;

WebApplicationBuilder builder = WebApplication.CreateSlimBuilder(args);
WebApplication app = builder.Build();

JsonSerializerOptions options = new()
{
	Converters = { new Converter() },
	TypeInfoResolver = AppJsonSerializerContext.Default,
};

app.MapMethods("{**path}", ["GET", "HEAD"], (HttpRequest request, HttpResponse response, string path = "") =>
{
	SqliteConnection connection = new("Data Source=tf.db;Mode=ReadOnly");
	connection.Open();

	bool get = request.Method == "GET";

	switch (request.Headers.Accept.ToString())
	{
		case "application/octet-stream":
			{
				using SqliteCommand command = connection.CreateCommand();
				command.CommandText = $"""
					SELECT "bytes"{(get ? ", \"data\"" : "")} FROM "tf"
					WHERE "name" = $path
					LIMIT 1;
				""";
				command.Parameters.AddWithValue("$path", path);

				SqliteDataReader reader = command.ExecuteReader(CommandBehavior.SingleRow | CommandBehavior.SequentialAccess);
				if (!reader.Read())
				{
					return Results.NotFound();
				}

				response.Headers.ContentLength = reader.GetInt32("bytes");

				return get
					? Results.Stream(new BrotliStream(reader.GetStream("data"), CompressionMode.Decompress))
					: Results.Empty;
			}
		case "application/json":
			{
				using SqliteCommand command = connection.CreateCommand();
				command.CommandText = """
					SELECT
					DISTINCT
						SUBSTRING("name", 0, CASE WHEN INSTR("name", '/') > 0 THEN INSTR("name", '/') ELSE LENGTH("name") END) AS "name",
						SIGN(INSTR("name", '/')) AS "type"
					FROM (SELECT SUBSTRING("name", $length + 2) AS "name" FROM "tf" WHERE "tf"."name" LIKE $path || '/%')
					ORDER BY "type" DESC, "name" ASC;
				""";

				path = Path.TrimEndingDirectorySeparator(path);

				command.Parameters.AddWithValue("$path", path);
				command.Parameters.AddWithValue("$length", path.Length);

				using SqliteDataReader reader = command.ExecuteReader();

				List<(string, byte)> folder = [];
				while (reader.Read())
				{
					folder.Add((reader.GetString("name"), reader.GetByte("type")));
				}

				return Results.Json(folder.ToArray(), options);
			}
		default:
			{
				if (path == "")
				{
					return Results.Text(File.ReadAllText("README.md"), contentType: "text/markdown");
				}
				else
				{
					return Results.StatusCode((int)HttpStatusCode.NotAcceptable);
				}
			}
	}
});

app.Run();

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
