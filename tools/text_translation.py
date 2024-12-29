# tools/text_translation.py
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
import os
from dotenv import load_dotenv
import asyncio

load_dotenv()

translation_template = """
Translate the following text into {language}. Return ONLY the translation, nothing else.

Text to translate: {text}
"""

async def translate(text: str, language: str) -> str:
    """
    Asynchronously translate text using OpenAI's API via LangChain.
    
    Args:
        text (str): Text to translate
        language (str): Target language
        
    Returns:
        str: Translated text
    """
    try:
        print(f"Translating text to {language}: {text}")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not found in environment variables")

        # Initialize LLM
        llm = ChatOpenAI(
            temperature=0.0,
            model="gpt-4-turbo-preview",
            api_key=api_key
        )
        
        # Create prompt template
        prompt = ChatPromptTemplate.from_template(translation_template)
        
        # Create messages from prompt
        messages = await prompt.ainvoke({
            "language": language,
            "text": text
        })
        
        # Get response from LLM
        response = await llm.ainvoke(messages)
        
        translation = response.content
        print(f"Translation result: {translation}")
        return translation
        
    except Exception as e:
        print(f"Translation error: {str(e)}")
        return None