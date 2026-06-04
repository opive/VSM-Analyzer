from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from openai import OpenAI
import os

from vsm_engine import analyze_value_stream, build_ai_prompt

load_dotenv()

app = Flask(__name__)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.get_json()

    processes = data.get("processes", [])
    daily_demand = int(data.get("daily_demand", 100))
    available_time = int(data.get("available_time", 28800))  # seconds per shift (8h default)

    if not processes:
        return jsonify({"error": "No processes provided"}), 400

    # Takt time: available production time divided by customer demand
    # This is the drumbeat — how often you need to produce one unit
    takt_time = round(available_time / daily_demand, 2)

    analysis = analyze_value_stream(processes, takt_time, daily_demand)

    # Build AI prompt and call OpenAI
    prompt = build_ai_prompt(analysis)
    ai_recommendations = _get_ai_recommendations(prompt)

    return jsonify({
        "analysis": analysis,
        "ai_recommendations": ai_recommendations,
        "takt_time": takt_time,
    })


def _get_ai_recommendations(prompt: str) -> str:
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,
            temperature=0.4,
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"AI recommendations unavailable: {str(e)}"


if __name__ == "__main__":
    app.run(debug=True, port=5000)
