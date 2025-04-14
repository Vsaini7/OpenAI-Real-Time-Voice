from flask import Flask, request
from rag_handler import search  # Import your search function from rag_handler.py
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route("/retrieve", methods=["POST"])
def retrieve():
    # Get the JSON data sent in the POST request
    data = request.get_json()
    # Extract the "query" field from the JSON; default to empty string if missing
    query = data.get("query", "")
    # Call your FAISS retrieval function (assumed to return a list of matching documents)
    results = search(query)
    # Join the list of results into a single string separated by newlines
    result_text = "\n".join(results)
    # Return the result text as a plain text response
    return result_text

if __name__ == "__main__":
    # Run the server on port 5000
    app.run(port=5000)
