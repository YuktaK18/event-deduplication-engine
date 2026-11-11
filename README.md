# Exactly-Once Event De-duplication Engine

**SSD Micro Project**

## Project Overview
The Exactly-Once Event De-duplication Engine is a virtual lab that demonstrates how duplicate events can be detected and handled in event-driven systems.

The project provides an interactive simulator where users can configure event delivery, duplicate rates, workers, event ordering and failure scenarios to understand the importance of deduplication.

## Live Demo
[Open the Virtual Lab](https://event-dedup-engine.netlify.app/)

## Problem Statement
In distributed systems, the same event may be delivered multiple times due to retries, network failures or message redelivery. Processing duplicate events can lead to incorrect results, such as repeated payment transactions.

This project demonstrates how deduplication techniques help prevent duplicate processing.

## Objectives
- Understand event duplication in distributed systems.
- Demonstrate the working of a deduplication engine.
- Compare processing with deduplication enabled and disabled.
- Explore event ordering and worker failure scenarios.
- Understand idempotency and reliable event processing.

## Key Features
- Interactive event processing simulator.
- Configurable logical event count.
- Adjustable duplicate delivery rate.
- Multiple worker configuration.
- Deduplication ON/OFF option.
- Ordered and out-of-order event modes.
- Worker crash failure simulation.
- Experiment presets and result comparison.

## Technologies Used
- Frontend: React
- Language: TypeScript
- Styling: Tailwind CSS
- Build Tool: Vite
- Deployment: Netlify

## How to Run Locally

1. Clone the repository:

   `git clone https://github.com/YuktaK18/event-deduplication-engine.git`

2. Open the project folder:

   `cd event-deduplication-engine`

3. Install dependencies:

   `npm install`

4. Start the development server:

   `npm run dev`

5. Open the local URL displayed in the terminal.

## Project Architecture
The simulator conceptually demonstrates the following components:

1. Event Producer
2. Message Queue
3. Deduplication Engine
4. Deduplication Registry

**Note:** The current version is a frontend-based simulation for educational purposes. It does not implement a live backend, actual message queue or AWS integration.

## Future Scope
- Integrate AWS Lambda and API Gateway.
- Use DynamoDB for event tracking and deduplication.
- Add persistent event processing and monitoring.
- Implement backend-based event processing.

## Project Links
- GitHub Repository: https://github.com/YuktaK18/event-deduplication-engine
- Live Virtual Lab: https://event-dedup-engine.netlify.app/

## Academic Project
SSD Micro Project – Exactly-Once Event De-duplication Engine.
