import "https://deno.land/x/xhr@0.1.0/mod.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Process base64 in chunks to prevent memory issues
function processBase64Chunks(base64String: string, chunkSize = 32768) {
  const chunks: Uint8Array[] = [];
  let position = 0;
  
  while (position < base64String.length) {
    const chunk = base64String.slice(position, position + chunkSize);
    const binaryChunk = atob(chunk);
    const bytes = new Uint8Array(binaryChunk.length);
    
    for (let i = 0; i < binaryChunk.length; i++) {
      bytes[i] = binaryChunk.charCodeAt(i);
    }
    
    chunks.push(bytes);
    position += chunkSize;
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAIApiKey) {
      console.error('OPENAI_API_KEY is not set')
      throw new Error('OPENAI_API_KEY is not configured')
    }

    const { audio, mimeType } = await req.json()
    
    if (!audio) {
      console.error('No audio data provided')
      throw new Error('No audio data provided')
    }

    console.log('Processing audio file, mimeType:', mimeType)

    // Process audio in chunks
    const binaryAudio = processBase64Chunks(audio)
    console.log('Audio binary size:', binaryAudio.length, 'bytes')
    
    // Determine file extension based on mime type
    let extension = 'webm'
    if (mimeType) {
      if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
        extension = 'mp3'
      } else if (mimeType.includes('wav')) {
        extension = 'wav'
      } else if (mimeType.includes('m4a') || mimeType.includes('mp4')) {
        extension = 'm4a'
      } else if (mimeType.includes('ogg')) {
        extension = 'ogg'
      }
    }

    // Prepare form data
    const formData = new FormData()
    const blob = new Blob([binaryAudio], { type: mimeType || 'audio/webm' })
    formData.append('file', blob, `audio.${extension}`)
    formData.append('model', 'whisper-1')
    formData.append('language', 'th') // Thai language

    console.log('Sending to OpenAI Whisper API...')

    // Send to OpenAI
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    console.log('Transcription successful:', result.text?.substring(0, 100))

    return new Response(
      JSON.stringify({ text: result.text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in transcribe-audio function:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
