"""OpenAI reranking keeps real classifier scores paired with their input passages."""

import asyncio
from math import log
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
from graphiti_core.llm_client import LLMConfig


def response(token='True', probability=0.8):
    prediction = SimpleNamespace(token=token, logprob=log(probability))
    return SimpleNamespace(choices=[SimpleNamespace(logprobs=SimpleNamespace(
        content=[SimpleNamespace(top_logprobs=[prediction])]))])


def ranker_for(responses, model=None):
    create = AsyncMock(side_effect=responses)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    return OpenAIRerankerClient(config=LLMConfig(model=model), client=client), create


def test_real_scores_remain_paired_after_sorting():
    ranker, create = ranker_for([response('False', 0.9), response('True', 0.8), response('True', 0.4)])
    result = asyncio.run(ranker.rank('query', ['first', 'second', 'third']))
    assert [passage for passage, _ in result] == ['second', 'third', 'first']
    assert [score for _, score in result] == pytest.approx([0.8, 0.4, 0.1])
    assert all(call.kwargs['model'] == 'gpt-4o-mini' for call in create.await_args_list)
    assert all(call.kwargs['logprobs'] is True for call in create.await_args_list)


@pytest.mark.parametrize('missing', [
    SimpleNamespace(choices=[]),
    SimpleNamespace(choices=[SimpleNamespace(logprobs=None)]),
    SimpleNamespace(choices=[SimpleNamespace(logprobs=SimpleNamespace(content=None))]),
    SimpleNamespace(choices=[SimpleNamespace(logprobs=SimpleNamespace(content=[]))]),
    SimpleNamespace(choices=[SimpleNamespace(logprobs=SimpleNamespace(
        content=[SimpleNamespace(top_logprobs=[])]))]),
])
def test_missing_middle_score_fails_without_shifting_other_scores(missing):
    ranker, _ = ranker_for([response(), missing, response('False')])
    with pytest.raises(ValueError, match='no token log-probabilities for passage 1'):
        asyncio.run(ranker.rank('query', ['first', 'second', 'third']))


@pytest.mark.parametrize('token,logprob', [('Maybe', -0.2), ('True', float('nan')),
                                        ('True', float('inf')), ('False', 0.2)])
def test_invalid_classifier_score_is_not_invented(token, logprob):
    result = response()
    result.choices[0].logprobs.content[0].top_logprobs[0] = SimpleNamespace(token=token, logprob=logprob)
    ranker, _ = ranker_for([result])
    with pytest.raises(ValueError, match='invalid binary score for passage 0'):
        asyncio.run(ranker.rank('query', ['first']))


def test_explicit_model_and_empty_input_are_preserved():
    ranker, create = ranker_for([response()], model='configured-reranker')
    assert asyncio.run(ranker.rank('query', [])) == []
    create.assert_not_awaited()
    asyncio.run(ranker.rank('query', ['first']))
    assert create.await_args.kwargs['model'] == 'configured-reranker'
