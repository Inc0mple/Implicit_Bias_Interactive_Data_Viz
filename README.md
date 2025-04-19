# LLM Implicit Bias Interactive Visualisation

[![GitHub Pages](https://img.shields.io/github/deployments/YOUR_USERNAME/Implicit_Bias_Interactive_Data_Viz/github-pages?label=GitHub%20Pages&style=flat-square)](https://inc0mple.github.io/Implicit_Bias_Interactive_Data_Viz/) 

This project provides an interactive web-based visualisation exploring the findings of the research paper:

**"Unmasking Implicit Bias: Evaluating Persona-Prompted LLM Responses in Power-Disparate Social Scenarios"**

[![arXiv](https://img.shields.io/badge/arXiv-2503.01532-b31b1b.svg?style=flat-square)](https://arxiv.org/abs/2503.01532)

## Overview

Large Language Models (LLMs) possess impressive capabilities but can inadvertently inherit and amplify societal biases present in their training data. This research investigates how assigning demographic personas (e.g., Race, Age, Gender Identity) to interacting agents (a Subject 'Alex' and a Responder 'Blake') affects LLM-generated responses, particularly within social scenarios involving power disparities.

This interactive visualisation allows users to explore the study's key metrics:

1.  **Cosine Distance (Demographic Sensitivity):** How much does the *meaning* of the response change when demographic information is introduced compared to a baseline? (Higher = more change).
2.  **Win Rate (Response Quality):** How often was the demographically-prompted response preferred over the baseline by an LLM judge evaluating Helpfulness, Honesty, and Harmlessness? (Score > 0.5 indicates preference for the demographically-prompted response).

## Features

*   **Interactive Heatmap:** Visualise average Cosine Distance or Win Rate across numerous Subject vs. Responder demographic pairings.
*   **Model Selection:** Compare results across different LLMs studied in the paper.
*   **Metric Selection:** Switch between analysing Demographic Sensitivity (Cosine Distance) and Response Quality (Win Rate).
*   **Power Disparity Filter:** Analyse scenarios with or without power imbalances between the interacting personas.
*   **Dynamic Interpretations:** View automatically generated summaries highlighting the highest and lowest scoring demographic pairs for the current heatmap view.
*   **Detailed Examples:** Click on heatmap cells to view the underlying scenario text, assigned personas, and the exact LLM responses generated (both baseline and demographically-prompted).
*   **Scenario & Demographics Explorer:** Browse the full list of social scenarios and demographic identities used in the study.
*   **Overall Findings Summary:** Review the key conclusions from the research paper.

## Accessing the Visualisation & Data

*   **Live Visualisation:** [**Explore the interactive tool here**](https://inc0mple.github.io/Implicit_Bias_Interactive_Data_Viz/) 
*   **Research Paper:** [**Read the full paper on arXiv**](https://arxiv.org/abs/2503.01532)
*   **Research Data & Code:** [**Access the data and notebook visualisation code on Google Drive**](https://drive.google.com/drive/folders/1EEzraT5-YVlANBYtnl-F8eBzczu49782?usp=drive_link)
