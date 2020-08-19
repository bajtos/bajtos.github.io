---
title: Sustaining and growing LoopBack as a successful open source project
date: 2017-12-11
originalUrl: https://medium.com/@bajtos/sustaining-loopback-project-b67fd59673e4
---

## The history

LoopBack 1.0 was announced on September 18th, 2013
([the announcement](https://web.archive.org/web/20131030211617/https://strongloop.com/strongblog/announcing-loopback-an-open-source-mobile-backend-as-a-service-based-on-node-js/)).
Within the next year, we were able to get more than 20 people to contribute to
our new framework
([the stats](https://github.com/strongloop/loopback/graphs/contributors?from=2013-09-19&to=2014-09-13&type=c)),
some of them contributed non-trivial features and were promoted to maintainers
([fabien](https://github.com/fabien), [clarkorz](https://github.com/clarkorz)
and [STRML](https://github.com/STRML) to name a few). What a great start!

Unfortunately we did not play the midgame similarly well. As the number of users
started to grow, there were more questions to answer, more issues to triage and
fix, more pull requests to review and land. It soon became way too much for our
team of three to keep up with, and thus the number of open pull requests started
to grow, the number of open issues skyrocketed and many early adopters and
contributors left the project.

If you are following the trends in open-source, or if you were around Node.js
before the io.js fork happened, then this should sound all too familiar to you.
Our struggles were not exceptional, they were (and still are) rather the norm in
most open-source projects.

But does it have to be this way? Is there any light at the end of this dark
tunnel?

In his excellent post on
[Healthy Open Source](https://medium.com/the-node-js-collection/healthy-open-source-967fa8be7951),
Mikeal explains the concept of users, contributors and commiters and describes
what a healthy open-source project looks like (emphasis is mine):

> This is what a healthy project should look like. As the demands on the project
> from increased users rise, so do the contributors, and as contributors
> increase more are converted into committers. As the committer base grows, more
> of them rise to the level of expertise where they should be involved in higher
> level decision making.

> **If these groups don’t grow in proportion to each other they can’t carry the
> load imposed on them by outward growth. A project’s ability to convert people
> from each of these groups is the only way it can stay healthy if its user base
> is growing.**

And here is what happens to a project when it’s not healthy:

> A massive user base is pushing a lot of contributions onto a very small number
> of maintainers. (…) We know what happens to unhealthy projects over a long
> enough time period, more maintainers leave, contributions eventually fall, and
> if we’re lucky users leave it. When we aren’t so lucky adoption continues and
> years later we’re plagued with security and stability issues in widely adopted
> software that can’t be effectively maintained.

Personally, this is exactly what I was seeing in LoopBack for the past several
years and what I was trying to change (with little success).

Now that we have sort of a clean start with LoopBack 4 (a.k.a loopback-next),
I’d like us to take this opportunity to not only fix our code, but also fix our
processes to make our project sustainable again; so that when LoopBack 4 starts
gaining more and more popularity, the number of contributors and committers will
keep growing too.

Another aspect I’d like to point out is integration between different features
offered by the framework. For example, LoopBack 3.x offers pretty good SDK for
Angular.js and also a storage component for persisting large(ish) files in the
cloud. However, to this date, there is no easy way how to upload new files from
Angular.js applications via the storage component APIs. IMO, this is a part of a
bigger problem of (a lack of) feature completeness and ease of use (think about
missing support for SQL JOINs in querying, or inability to attach additional
metadata to uploaded/stored files for more examples)

_As I see it, we were good at releasing an MVP version that brought lots of
attention, but we failed to address the feedback from the early adopters and did
not follow up to improve the MVP into something actually useful._

## The proposal

### P1: build our community

I am proposing to make it our priority #1 to take a good care of people
contributing to LoopBack in any way — from asking questions about parts that are
not easy to use, to reporting issues and submitting pull requests. In my
experience, this boils down to several practices:

- Be responsive, don’t let pull requests/issues/comments go unnoticed for days.
  (Or months, as is the case in our old repositories!)
- Be empathetic, try to put yourself in the shoes of the other person. What
  problem are they trying to solve? How can we help them to be successfull with
  LoopBack?
- Read between the lines and look for root causes. A person asking a question
  that looks silly to us may be giving us valuable feedback about something
  that’s missing in our documentation. More often than not, the need for
  extensive documentation may mean that our design is too complex and difficult
  to use. We should use these opportunities to rethink the big picture and
  improve the developer experience.
- Especially when reviewing pull requests, unless there are good reasons why to
  reject the proposed changes, we should default to accept community
  contributions. At the end of the day, feedback from people putting our
  framework into real word use is usually more relevant than ideas we may have
  in the ivory tower we (full-time maintainers) live in. (This does not mean we
  should be landing crappy code not following our coding style or breaking the
  builds though!)
- We should be willing to give up control. As we grow in number of modules and
  features, we should encourage more contributors and grow them into committers.

We need to have the mindset that the community are our (paying) customers to
make the framework successful. Take issues, questions and pull requests
seriously and responsively. Put extra efforts to review/refine/merge PRs and use
the exercise to mentor and develop future committers. It’s our team’s mission to
have more and more happy customers.

### P2: fix bugs quickly

Let me quote from [No Bugs](http://www.jamesshore.com/Agile-Book/no_bugs.html)
of James Shore’s Agile Book:

> Programmers have long known that the longer you wait to fix a bug, the more it
> costs to fix. In addition, unfixed bugs probably indicate further problems.
> Each bug is the result of a flaw in your system that’s likely to breed more
> mistakes. Fix it now and you’ll improve both quality and productivity.

I’d like us to prioritize bugs reported from LoopBack users over work on new
features and try to maintain the state of zero open bugs in our issue tracker.

There are two important things to consider:

First, not all bugs deserve to be fixed, there are times when closing a bug as
“won’t fix” makes perfect sense.

Secondly, in order to attract new contributors, we need to have a collection of
issues suitable for first-time contributors. (GitHub promotes using the label
“good first issue” for those issues.) If we fix all easy bugs right away, we
will miss the opportunity to let a new contributor to fix it for us.

I think this can be easily addressed by delaying the work on fixing easy bugs
until the next sprint. This way there is usually an opportunity window of 1–2
weeks for community contributions, but if nobody picks up the challenge, then
the bug will be still fixed in reasonable time.

### P3: focus on finishing our Minimum Viable Product

Right now, LoopBack 4 is not feature complete enough to allow building even the
simplest applications. As a result, there are very few people trying our new
framework and giving us feedback on what works and what needs improvements. It
should be our highest priority to deliver a
[Walking Skeleton](http://alistair.cockburn.us/Walking+skeleton) (issues
labelled as
[MVP](https://github.com/strongloop/loopback-next/issues?utf8=%E2%9C%93&q=is%3Aissue+label%3AMVP)),
that will allow our early adopters to start building their first applications
and provide us with feedback on what are the important areas to improve and what
popular features we are missing.

Without MVP, we risk building features that very few people will use, wasting
our precious time on implementing things with low impact, while missing
important uses cases that are deal-breakers for potential new users.

### Post MVP

Once we have the first usable version, it’s crucial to keep the discipline in
building a sustainable process.

- Always care about the developer experience. Sometimes trivial fix or
  improvement helps a lot.
- Seek a good balance between fixing existing problems or adding new features
  driven by the community and our vision.
- Be bold to admit failures in certain areas and remove bad features from the
  main stream.
- Prioritize work on refactoring code that blocks us from adding new features or
  fixing bugs in cleaner ways.

## Closing thoughts

My blogpost outlined a high-level strategy we would like to embrace going
forward. There are tactical details we need to figure out as a team, for example
what are we going to start doing differently to deliver on this strategy? How
exactly are we going to balance between community support, fixing bugs and
working on new features pushing the framework forward? I don’t have answers for
this question yet, but I am sure we will figure it out!

You may be also wondering about the current 3.x version of LoopBack, will it see
better support too? The answer is yes and now. Our bandwidth is limited and with
all work on LoopBack 4, there remains only very little time to support 3.x
version for non-paying users. At the same time, we value community contributions
highly and if you invest your time in sending us a pull request, we promise to
do our best to review it in a timely manner.
