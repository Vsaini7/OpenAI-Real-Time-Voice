import openai
import faiss
import numpy as np


#  HARD CODE your OpenAI API key
openai.api_key =  "Enter API KEY"
#"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"

#  Documents to embed and store
docs = [




    "To open a savings account, visit our nearest branch with your ID proof.Fill out the paperwork. Turn-around time is 3-5 days and you will be good.",
    "Loan eligibility depends on your monthly income and credit history.",
    "We charge a fixed monthly fee for all credit card holders.",
    "You can block your debit card instantly using our mobile app.",
    "To reset your password, click 'Forgot Password' on the login screen."
]

# Get embeddings from OpenAI
def get_embedding(text):
    response = openai.Embedding.create(
        model="text-embedding-3-small",
        input=[text]
    )
    return np.array(response['data'][0]['embedding'])

# Build FAISS index
dimension = 1536  # For text-embedding-3-small
index = faiss.IndexFlatL2(dimension)

# Store document embeddings
doc_embeddings = [get_embedding(doc) for doc in docs]
index.add(np.array(doc_embeddings))

# Retrieval based on user query
def search(query, top_k=2):
    query_vec = get_embedding(query)
    D, I = index.search(np.array([query_vec]), top_k)
    return [docs[i] for i in I[0]]

#  Test it
if __name__ == "__main__":
    user_question = "How do I block my card?"
    print("🔍 Top Matches:")
    for result in search(user_question):
        print("➡️", result)