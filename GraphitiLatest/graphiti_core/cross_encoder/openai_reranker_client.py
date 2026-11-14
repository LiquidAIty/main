"""
Copyright 2024, Zep Software, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
"""

import logging
from typing import Any

import numpy as np
import openai
from openai import AsyncAzureOpenAI, AsyncOpenAI

from ..helpers import semaphore_gather
from ..llm_client import LLMConfig, OpenAIClient, RateLimitError
from ..prompts import Message
from .client import CrossEncoderClient

logger = logging.getLogger(__name__)

# The default must expose token log-probabilities on the configured compatible endpoint.
DEFAULT_MODEL = 'gpt-4o-mini'


class OpenAIRerankerClient(CrossEncoderClient):
    def __init__(
        self,
        config: LLMConfig | None = None,
        client: AsyncOpenAI | AsyncAzureOpenAI | OpenAIClient | None = None,
    ):
        """
        Initialize the OpenAIRerankerClient with the provided configuration and client.

        This reranker uses the OpenAI API to run a simple boolean classifier prompt concurrently
        for each passage. Log-probabilities are used to rank the passages.

        Args:
            config (LLMConfig | None): The configuration for the LLM client, including API key, model, base URL, temperature, and max tokens.
            client (AsyncOpenAI | AsyncAzureOpenAI | OpenAIClient | None): An optional async client instance to use. If not provided, a new AsyncOpenAI client is created.
        """
        if config is None:
            config = LLMConfig()

        self.config = config
        if client is None:
            self.client = AsyncOpenAI(api_key=config.api_key, base_url=config.base_url)
        elif isinstance(client, OpenAIClient):
            self.client = client.client
        else:
            self.client = client

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        openai_messages_list: Any = [
            [
                Message(
                    role='system',
                    content='You are an expert tasked with determining whether the passage is relevant to the query',
                ),
                Message(
                    role='user',
                    content=f"""
                           Respond with "True" if PASSAGE is relevant to QUERY and "False" otherwise.
                           <PASSAGE>
                           {passage}
                           </PASSAGE>
                           <QUERY>
                           {query}
                           </QUERY>
                           """,
                ),
            ]
            for passage in passages
        ]
        try:
            responses = await semaphore_gather(
                *[
                    self.client.chat.completions.create(
                        model=self.config.model or DEFAULT_MODEL,
                        messages=openai_messages,
                        temperature=0,
                        max_tokens=1,
                        logit_bias={'6432': 1, '7983': 1},
                        logprobs=True,
                        top_logprobs=2,
                    )
                    for openai_messages in openai_messages_list
                ]
            )

            results: list[tuple[str, float]] = []
            for index, (passage, response) in enumerate(zip(passages, responses, strict=True)):
                logprobs = response.choices[0].logprobs if response.choices else None
                content = logprobs.content if logprobs is not None else None
                top_logprobs = content[0].top_logprobs if content else []
                if not top_logprobs:
                    raise ValueError(f'Reranker returned no token log-probabilities for passage {index}')
                prediction = top_logprobs[0]
                token = prediction.token.strip().lower()
                if token not in {'true', 'false'} or not np.isfinite(prediction.logprob) or prediction.logprob > 0:
                    raise ValueError(f'Reranker returned an invalid binary score for passage {index}')
                probability = float(np.exp(prediction.logprob))
                results.append((passage, probability if token == 'true' else 1 - probability))
            results.sort(reverse=True, key=lambda x: x[1])
            return results
        except openai.RateLimitError as e:
            raise RateLimitError from e
        except Exception as e:
            logger.error(f'Error in generating LLM response: {e}')
            raise
