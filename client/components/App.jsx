import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);

  // START SESSION: Establish connection with OpenAI Realtime API
  async function startSession() {
    // Get a session token for OpenAI Realtime API
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    // Update session instructions if the realtime client is available.
    // (Replace "client" with your realtime client instance, if available.)
    if (typeof client !== "undefined" && client.updateSession) {
      client.updateSession({
        instructions:
          "Answer only using the retrieved documents from our knowledge base. If no relevant document is found, respond with 'I cannot answer.'",
      });
    } else {
      console.warn(
        "Realtime client not defined. Make sure to update session instructions if possible."
      );
    }

    peerConnection.current = pc;
  }

  // STOP SESSION: Clean up the connection
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    peerConnection.current.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });

    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // SEND A MESSAGE TO THE MODEL VIA THE DATA CHANNEL
  function sendClientEvent(message) {
    if (dataChannel) {
      const timestamp = new Date().toLocaleTimeString();
      message.event_id = message.event_id || crypto.randomUUID();

      // Send the event (the backend peer doesn't expect the timestamp, so send it first)
      dataChannel.send(JSON.stringify(message));

      // If the timestamp is not already set (guard just in case), set it.
      if (!message.timestamp) {
        message.timestamp = timestamp;
      }
      setEvents((prev) => [message, ...prev]);
    } else {
      console.error("Failed to send message - no data channel available", message);
    }
  }

  // SEND TEXT MESSAGE: This function is now async so we can use await
  async function sendTextMessage(message) {
    // Prepend instruction for every query
  const instruction = "Answer only using the retrieved documents from our knowledge base. If no relevant document is found, respond with 'I cannot answer.'";
  const fullMessage = `${instruction}\n\n${message}`;

  // 1. Send the user message (with the instruction prepended)
  const event = {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: fullMessage,
        },
      ],
    },
  };
  sendClientEvent(event);

  // 2. Force retrieval from Python backend
  const response = await fetch("http://localhost:5000/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: message }),
  });
  const retrievedDocs = await response.text();

  // 3. Send tool response
  const toolResponseEvent = {
    type: "tool_response",
    tool: { name: "retrieve_documents", result: retrievedDocs },
    tool_call_id: crypto.randomUUID(),
  };
  sendClientEvent(toolResponseEvent);

  // 4. Trigger response generation
  sendClientEvent({ type: "response.create" });

  }

  // ATTACH EVENT LISTENERS: Listen for events from the data channel
  useEffect(() => {
    if (dataChannel) {
      dataChannel.addEventListener("message", async (e) => {
        console.log("[DEBUG] Raw message received:", e.data);
        const event = JSON.parse(e.data);
        // NEW: Catch GPT function calls embedded in response.done
if (
  event.type === "response.done" &&
  event.response?.output?.length > 0
) {
  const outputs = event.response.output;

  outputs.forEach(async (output) => {
    if (
      output.type === "function_call" &&
      output.name === "retrieve_documents"
    ) {
      console.log("[DEBUG] retrieve_documents function_call received in response.done:", output);

      try {
        const args = JSON.parse(output.arguments);
        const query = args.query;
        console.log("[DEBUG] Extracted query:", query);

        const response = await fetch("http://localhost:5000/retrieve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) throw new Error(`Backend error: ${response.status}`);
        const result = await response.text();
        console.log("[DEBUG] RAG backend returned:", result);

        const responseEvent = {
          type: "response.create",
          response: {
            instructions: result, // this will be spoken by GPT-4o
          },
        };
        sendClientEvent(responseEvent);
        
      } catch (error) {
        console.error("❌ Error calling retrieve_documents backend:", error);
        // ✅ Fallback response also uses response.create
        sendClientEvent({
          type: "response.create",
          response: {
            instructions: "Sorry, I couldn't retrieve any document for that question.",
          },
        });
      }
    }
  });
}


        // Check for a tool call event with name "retrieve_documents"
        if (event.type === "tool_call" && event.tool && event.tool.name === "retrieve_documents") {
          console.log("[DEBUG] retrieve_documents tool call received:", event);
          try {
            const args = JSON.parse(event.tool.arguments);
            const query = args.query;
            console.log("[DEBUG] Query received for retrieval:", query);

            const response = await fetch("http://localhost:5000/retrieve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query }),
            });
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.text();
            console.log("[DEBUG] Backend returned:", result);

           // ✅ send as response.create
    const responseEvent = {
      type: "response.create",
      response: {
        instructions: result,
      },
    };
    sendClientEvent(responseEvent);

  } catch (error) {
    console.error("Error in retrieve_documents tool:", error);
    sendClientEvent({
      type: "response.create",
      response: {
        instructions: "Sorry, I had trouble retrieving that document.",
      },
    });
  }
}

        // Log every event for debugging
        if (!event.timestamp) {
          event.timestamp = new Date().toLocaleTimeString();
        }
        setEvents((prev) => [event, ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} alt="OpenAI logo" />
          <h1>realtime console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <ToolPanel
            sendClientEvent={sendClientEvent}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
          />
        </section>
      </main>
    </>
  );
}
