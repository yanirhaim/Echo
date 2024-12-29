# tools/text_translation.py
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
import os
from dotenv import load_dotenv
import asyncio

load_dotenv()

translation_template = """
Translate the following sentence into {language}, return ONLY the translation, nothing else.

Sentence: {sentence}
"""

async def translate(sentence: str, language: str) -> str:
    """
    Asynchronously translate text using OpenAI's API via LangChain.
    
    Args:
        sentence (str): Text to translate
        language (str): Target language
    
    Returns:
        str: Translated text
    """
    try:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not found in environment variables")

        # Initialize components
        llm = ChatOpenAI(
            temperature=0.0, 
            model="gpt-4-turbo-preview", 
            api_key=api_key
        )
        prompt = ChatPromptTemplate.from_template(translation_template)
        
        # Create messages from prompt
        messages = await prompt.ainvoke({
            "language": language,
            "sentence": sentence
        })
        
        # Get response from LLM
        response = await llm.ainvoke(messages)
        
        # Parse output
        return response.content
        
    except Exception as e:
        print(f"Translation error: {str(e)}")
        return f"Translation error: {str(e)}"