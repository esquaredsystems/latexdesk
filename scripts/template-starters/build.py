#!/usr/bin/env python3
"""Writes the starter templates, compiles each one with latexmk, and zips the ones that build.

Usage: python3 scripts/template-starters/build.py templates [id ...]
"""
import os, shutil, subprocess, sys, tempfile, zipfile, re

HERE = os.path.dirname(os.path.abspath(__file__))
COMMON = HERE  # references.bib, placeholder.pdf (built from fig.tex)

BODY = r"""
\section{Introduction}\label{sec:intro}
Write the introduction here. Cite sources with \verb|\cite|, for example the \LaTeX{}
manual~\cite{lamport1994} or the original line-breaking paper~\cite{knuth1981}, and refer to
sections, figures and equations by their labels (Section~\ref{sec:method}).

\section{Method}\label{sec:method}
Equations are numbered and can be referenced, as in~\eqref{eq:model}:
\begin{equation}
  y = \alpha + \beta x + \varepsilon .
  \label{eq:model}
\end{equation}

\begin{figure}[t]
  \centering
  \includegraphics[width=0.8\linewidth]{figures/placeholder}
  \caption{A figure. Replace \texttt{figures/placeholder.pdf} with your own file.}
  \label{fig:example}
\end{figure}

\section{Results}\label{sec:results}
Figure~\ref{fig:example} and Table~\ref{tab:example} show how floats are placed.

\begin{table}[t]
  \centering
  \caption{A table with a caption above it.}
  \label{tab:example}
  \begin{tabular}{lrr}
    \hline
    Method & Accuracy & Time (s) \\
    \hline
    Baseline & 0.81 & 12.0 \\
    Proposed & 0.87 & 9.5 \\
    \hline
  \end{tabular}
\end{table}

\section{Conclusion}\label{sec:conclusion}
Summarise the findings and the next steps.
"""

ABSTRACT = 'Write a short summary of the work here: the problem, the method, the main result, and why it matters.'

def bib_natbib(style):
    return f"\\bibliographystyle{{{style}}}\n\\bibliography{{references}}\n"

T = {}

T['ieee-conference'] = r"""\documentclass[conference]{IEEEtran}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{cite}
\usepackage{hyperref}

\begin{document}

\title{Title of the Conference Paper}

\author{\IEEEauthorblockN{First Author}
\IEEEauthorblockA{\textit{Department} \\
\textit{University}\\
City, Country \\
first.author@example.org}
\and
\IEEEauthorblockN{Second Author}
\IEEEauthorblockA{\textit{Department} \\
\textit{University}\\
City, Country \\
second.author@example.org}}

\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}

\begin{IEEEkeywords}
first keyword, second keyword, third keyword
\end{IEEEkeywords}
BODY
\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
"""

T['ieee-journal'] = r"""\documentclass[journal]{IEEEtran}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{cite}
\usepackage{hyperref}

\begin{document}

\title{Title of the Journal Article}
\author{First~Author,~\IEEEmembership{Member,~IEEE,}
        and~Second~Author%
\thanks{F. Author and S. Author are with the Department of ..., University, City, Country
(e-mail: first.author@example.org).}%
\thanks{Manuscript received Month DD, YYYY.}}

\markboth{Journal of \LaTeX\ Class Files}{Author \MakeLowercase{\textit{et al.}}: Title of the Journal Article}

\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}

\begin{IEEEkeywords}
first keyword, second keyword, third keyword
\end{IEEEkeywords}
BODY
\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
"""

ACM_COMMON = r"""
\usepackage{amsmath}

\setcopyright{none}
\acmConference[Conference acronym 'XX]{Make sure to enter the correct conference title from your rights confirmation email}{June 03--05, 2026}{Woodstock, NY}

\begin{document}

\title{Title of the Paper}

\author{First Author}
\affiliation{%
  \institution{University}
  \city{City}
  \country{Country}}
\email{first.author@example.org}

\author{Second Author}
\affiliation{%
  \institution{Company}
  \city{City}
  \country{Country}}
\email{second.author@example.org}

\begin{abstract}
ABSTRACT
\end{abstract}

\keywords{first keyword, second keyword, third keyword}

\maketitle
BODY
\bibliographystyle{ACM-Reference-Format}
\bibliography{references}

\end{document}
"""
T['acm-sigconf'] = r"\documentclass[sigconf,screen]{acmart}" + ACM_COMMON
T['acm-journal'] = r"\documentclass[acmsmall,screen]{acmart}" + ACM_COMMON.replace(
    r"\acmConference[Conference acronym 'XX]{Make sure to enter the correct conference title from your rights confirmation email}{June 03--05, 2026}{Woodstock, NY}",
    r"\acmJournal{JACM}")

T['elsevier-elsarticle'] = r"""\documentclass[preprint,12pt]{elsarticle}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\journal{Name of the Journal}

\begin{document}

\begin{frontmatter}

\title{Title of the Article}

\author[inst1]{First Author\corref{cor1}}
\ead{first.author@example.org}
\cortext[cor1]{Corresponding author}
\author[inst2]{Second Author}

\affiliation[inst1]{organization={Department, University},
            city={City},
            country={Country}}
\affiliation[inst2]{organization={Company},
            city={City},
            country={Country}}

\begin{abstract}
ABSTRACT
\end{abstract}

\begin{keyword}
first keyword \sep second keyword \sep third keyword
\end{keyword}

\end{frontmatter}
BODY
\bibliographystyle{elsarticle-num}
\bibliography{references}

\end{document}
"""

CAS = r"""\usepackage{amsmath,amssymb}
\usepackage[numbers]{natbib}

\shorttitle{Title of the Article}
\shortauthors{F. Author et al.}

\begin{document}

\title [mode = title]{Title of the Article}

\author[1]{First Author}[orcid=0000-0000-0000-0000]
\cormark[1]
\ead{first.author@example.org}
\credit{Conceptualization, Writing -- original draft}

\author[2]{Second Author}
\credit{Software, Writing -- review and editing}

\affiliation[1]{organization={Department, University},
                city={City},
                country={Country}}
\affiliation[2]{organization={Company},
                city={City},
                country={Country}}

\cortext[1]{Corresponding author}

\begin{abstract}
ABSTRACT
\end{abstract}

\begin{keywords}
first keyword \sep second keyword \sep third keyword
\end{keywords}

\maketitle
BODY
\bibliographystyle{cas-model2-names}
\bibliography{references}

\end{document}
"""
T['elsevier-cas-dc'] = r"\documentclass[a4paper,fleqn]{cas-dc}" + "\n" + CAS
T['elsevier-cas-sc'] = r"\documentclass[a4paper,fleqn]{cas-sc}" + "\n" + CAS

T['springer-lncs'] = r"""\documentclass[runningheads]{llncs}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\begin{document}

\title{Title of the Contribution}
\author{First Author\inst{1}\orcidID{0000-0000-0000-0000} \and
Second Author\inst{2}}
\authorrunning{F. Author and S. Author}
\institute{University, City, Country\\
\email{first.author@example.org} \and
Company, City, Country}

\maketitle

\begin{abstract}
ABSTRACT
\keywords{First keyword \and Second keyword \and Third keyword.}
\end{abstract}
BODY
\bibliographystyle{splncs04}
\bibliography{references}

\end{document}
"""

REVTEX = r"""\usepackage{graphicx}
\usepackage{amsmath}
\usepackage{hyperref}

\begin{document}

\title{Title of the Article}

\author{First Author}
\email{first.author@example.org}
\affiliation{Department of Physics, University, City, Country}

\author{Second Author}
\affiliation{Laboratory, City, Country}

\date{\today}

\begin{abstract}
ABSTRACT
\end{abstract}

\maketitle
BODY
\bibliography{references}

\end{document}
"""
T['aps-revtex'] = r"\documentclass[aps,prl,twocolumn,superscriptaddress,showpacs]{revtex4-2}" + "\n" + REVTEX
T['aip-revtex'] = r"\documentclass[aip,jcp,reprint,amsmath,amssymb]{revtex4-2}" + "\n" + REVTEX.replace(r"\usepackage{amsmath}" + "\n", "")

T['aas-aastex'] = r"""\documentclass[twocolumn]{aastex631}
\usepackage{amsmath}

\begin{document}

\title{Title of the Article}

\author[0000-0000-0000-0000]{First Author}
\affiliation{Department of Astronomy, University, City, Country}
\email{first.author@example.org}

\author{Second Author}
\affiliation{Observatory, City, Country}

\begin{abstract}
ABSTRACT
\end{abstract}

\keywords{first keyword --- second keyword --- third keyword}
BODY
\bibliography{references}{}
\bibliographystyle{aasjournal}

\end{document}
"""

T['mnras'] = r"""\documentclass[fleqn,usenatbib]{mnras}
\usepackage{graphicx}
\usepackage{amsmath}

\title[Short title]{Title of the Article}
\author[F. Author et al.]{
First Author,$^{1}$\thanks{E-mail: first.author@example.org}
Second Author$^{2}$
\\
$^{1}$Department of Physics, University, City, Country\\
$^{2}$Observatory, City, Country
}
\date{Accepted XXX. Received YYY; in original form ZZZ}
\pubyear{2026}

\begin{document}
\label{firstpage}
\pagerange{\pageref{firstpage}--\pageref{lastpage}}
\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}

\begin{keywords}
first keyword -- second keyword -- third keyword
\end{keywords}
BODY
\bibliographystyle{mnras}
\bibliography{references}

\bsp
\label{lastpage}
\end{document}
"""

T['oup-general'] = r"""\documentclass[unnumsec,webpdf,contemporary,large]{oup-authoring-template}
\usepackage{graphicx}

\begin{document}

\journaltitle{Journal Title Here}
\DOI{DOI HERE}
\copyrightyear{2026}
\pubyear{2026}
\access{Advance Access Publication Date: Day Month Year}
\appnotes{Paper}

\firstpage{1}

\title[Short title]{Title of the Article}

\author[1,$\ast$]{First Author\ORCID{0000-0000-0000-0000}}
\author[2]{Second Author}

\authormark{F. Author et al.}

\address[1]{\orgdiv{Department}, \orgname{University}, \orgaddress{\street{Street}, \postcode{Postcode}, \state{State}, \country{Country}}}
\address[2]{\orgdiv{Laboratory}, \orgname{Institute}, \orgaddress{\country{Country}}}

\corresp[$\ast$]{Corresponding author. \href{mailto:first.author@example.org}{first.author@example.org}}

\received{Date}{0}{Year}
\revised{Date}{0}{Year}
\accepted{Date}{0}{Year}

\abstract{ABSTRACT}
\keywords{first keyword, second keyword, third keyword}

\maketitle
BODY
\bibliographystyle{plain}
\bibliography{references}

\end{document}
"""

T['acs-achemso'] = r"""\documentclass[journal=jacsat,manuscript=article]{achemso}
\usepackage{graphicx}
\usepackage{amsmath}

\author{First Author}
\email{first.author@example.org}
\affiliation{Department of Chemistry, University, City, Country}
\author{Second Author}
\affiliation{Institute, City, Country}

\title{Title of the Article}

\keywords{first keyword, second keyword}

\begin{document}

\begin{abstract}
ABSTRACT
\end{abstract}
BODY
\bibliography{references}

\end{document}
"""

T['pmlr-jmlr'] = r"""\documentclass[pmlr]{jmlr}
\usepackage{amsmath}

\jmlrvolume{vol}
\jmlryear{2026}
\jmlrworkshop{Name of the Conference or Workshop}

\title{Title of the Paper}
\author{\Name{First Author} \Email{first.author@example.org}\\
  \addr University, City, Country
  \AND
  \Name{Second Author} \Email{second.author@example.org}\\
  \addr Company, City, Country}

\begin{document}

\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}
\begin{keywords}
first keyword, second keyword
\end{keywords}
BODY
\bibliography{references}

\end{document}
"""

T['apa7'] = r"""\documentclass[man,12pt,donotrepeattitle]{apa7}
\usepackage[american]{babel}
\usepackage{csquotes}
\usepackage[style=apa,backend=biber]{biblatex}
\addbibresource{references.bib}

\title{Title of the Manuscript}
\shorttitle{Short Title}
\authorsnames{First Author, Second Author}
\authorsaffiliations{{Department of Psychology, University}}
\leftheader{Author}

\abstract{ABSTRACT}
\keywords{first keyword, second keyword, third keyword}
\authornote{Correspondence concerning this article should be addressed to First Author, Department of Psychology, University. Email: first.author@example.org}

\begin{document}
\maketitle

Write the introduction here. Cite in APA style with \verb|\textcite| or \verb|\parencite|:
\textcite{lamport1994} describes \LaTeX{}, and line breaking is treated in
\parencite{knuth1981}.

\section{Method}
\subsection{Participants}
Describe the sample.
\subsection{Procedure}
Describe the procedure.

\section{Results}
Report the results.

\section{Discussion}
Discuss the findings.

\printbibliography

\end{document}
"""

T['ams-article'] = r"""\documentclass{amsart}
\usepackage{amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}

\begin{document}

\title{Title of the Article}
\author{First Author}
\address{Department of Mathematics, University, City, Country}
\email{first.author@example.org}
\author{Second Author}
\address{Institute, City, Country}
\subjclass[2020]{Primary 00A00; Secondary 00A99}
\keywords{first keyword, second keyword}
\date{\today}

\begin{abstract}
ABSTRACT
\end{abstract}

\maketitle

\section{Introduction}\label{sec:intro}
State the problem and the main result, Theorem~\ref{thm:main}. Standard references
are~\cite{knuth1984,lamport1994}.

\begin{definition}
A \emph{widget} is a set $W$ together with a map $f\colon W \to W$.
\end{definition}

\begin{theorem}\label{thm:main}
Every finite widget has a fixed point of $f^n$ for some $n \ge 1$.
\end{theorem}

\begin{proof}
Write the proof here.
\end{proof}

\begin{remark}
Remarks are set in upright type.
\end{remark}

\bibliographystyle{amsplain}
\bibliography{references}

\end{document}
"""

THESIS_CHAPTERS = {
    'chapters/introduction.tex': r"""\chapter{Introduction}\label{ch:intro}
State the research problem, the questions, and the contributions of the thesis.
\LaTeX{} is described by~\cite{lamport1994}.

\section{Motivation}
Why the problem matters.

\section{Outline}
Chapter~\ref{ch:background} reviews the literature and Chapter~\ref{ch:method} describes the method.
""",
    'chapters/background.tex': r"""\chapter{Background}\label{ch:background}
Review the related work, as in~\cite{knuth1981}.
""",
    'chapters/method.tex': r"""\chapter{Method}\label{ch:method}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.7\textwidth]{figures/placeholder}
  \caption{A figure in a chapter.}
  \label{fig:method}
\end{figure}
Figure~\ref{fig:method} shows the approach. Equation~\eqref{eq:model} is the model:
\begin{equation}
  y = \alpha + \beta x .
  \label{eq:model}
\end{equation}
""",
    'chapters/conclusion.tex': r"""\chapter{Conclusion}\label{ch:conclusion}
Summarise the contributions and future work.
""",
}

T['koma-thesis'] = r"""\documentclass[11pt,a4paper,twoside,openright,headsepline,bibliography=totoc]{scrreprt}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\usepackage{hyperref}

\title{Title of the Thesis}
\subtitle{A thesis submitted for the degree of Doctor of Philosophy}
\author{Your Name}
\publishers{Department, University}
\date{Month Year}

\begin{document}

\pagenumbering{roman}
\maketitle

\chapter*{Abstract}
ABSTRACT

\chapter*{Acknowledgements}
Thank the people who helped.

\tableofcontents
\listoffigures

\cleardoublepage
\pagenumbering{arabic}
\include{chapters/introduction}
\include{chapters/background}
\include{chapters/method}
\include{chapters/conclusion}

\bibliographystyle{plainnat}
\bibliography{references}

\appendix
\chapter{Additional Material}
Supplementary results.

\end{document}
"""

T['classicthesis'] = r"""\documentclass[11pt,a4paper,twoside,openright,titlepage,headinclude,footinclude,BCOR=5mm,bibliography=totoc]{scrreprt}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\usepackage[drafting=false,parts=false,eulerchapternumbers,listings=false,floatperchapter]{classicthesis}
\usepackage{hyperref}

\begin{document}

\begin{titlepage}
  \centering
  \vspace*{3cm}
  {\LARGE\spacedallcaps{Title of the Thesis}\par}
  \vspace{2cm}
  {\Large\spacedlowsmallcaps{Your Name}\par}
  \vfill
  Department, University\\
  Month Year
\end{titlepage}

\pagenumbering{roman}
\chapter*{Abstract}
ABSTRACT

\tableofcontents

\cleardoublepage
\pagenumbering{arabic}
\include{chapters/introduction}
\include{chapters/background}
\include{chapters/method}
\include{chapters/conclusion}

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
"""

BOOK_CHAPTERS = {
    'chapters/chapter1.tex': r"""\chapter{The First Chapter}\label{ch:first}
Begin the book here. The standard reference for \TeX{} is~\cite{knuth1984}.

\section{A Section}
Text of the section. See Chapter~\ref{ch:second}.
""",
    'chapters/chapter2.tex': r"""\chapter{The Second Chapter}\label{ch:second}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.7\textwidth]{figures/placeholder}
  \caption{A figure in the book.}
  \label{fig:book}
\end{figure}
Figure~\ref{fig:book} shows a figure.
""",
}

T['memoir-book'] = r"""\documentclass[11pt,a4paper,twoside,openright]{memoir}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\usepackage{hyperref}

\chapterstyle{veelo}
\setsecnumdepth{subsection}

\title{Title of the Book}
\author{Author Name}
\date{2026}

\begin{document}

\frontmatter
\maketitle
\tableofcontents*

\chapter{Preface}
Explain who the book is for.

\mainmatter
\include{chapters/chapter1}
\include{chapters/chapter2}

\backmatter
\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
"""

T['koma-book'] = r"""\documentclass[11pt,a4paper,twoside,openright,bibliography=totoc,index=totoc]{scrbook}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\usepackage{makeidx}
\usepackage{hyperref}
\makeindex

\title{Title of the Book}
\subtitle{Subtitle}
\author{Author Name}
\publishers{Publisher}
\date{2026}

\begin{document}

\frontmatter
\maketitle
\tableofcontents

\chapter{Preface}
Explain who the book is for.\index{preface}

\mainmatter
\include{chapters/chapter1}
\include{chapters/chapter2}

\backmatter
\bibliographystyle{plainnat}
\bibliography{references}
\printindex

\end{document}
"""

T['tufte-book'] = r"""\documentclass[nobib]{tufte-book}
\usepackage{graphicx}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage[numbers]{natbib}

\title{Title of the Book}
\author{Author Name}
\publisher{Publisher}

\begin{document}

\maketitle
\tableofcontents

\chapter{Introduction}\label{ch:intro}
Tufte-style books keep wide margins for side notes.\sidenote{Side notes are numbered like
footnotes but sit in the margin.} Margin figures sit next to the text they explain.

\begin{marginfigure}
  \includegraphics[width=\linewidth]{figures/placeholder}
  \caption{A margin figure.}
  \label{fig:margin}
\end{marginfigure}

\section{A Section}
Figure~\ref{fig:margin} is in the margin. The \TeX{} reference is~\cite{knuth1984}.

\begin{figure*}
  \includegraphics[width=\linewidth]{figures/placeholder}
  \caption{A full-width figure.}
  \label{fig:wide}
\end{figure*}

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
"""

T['tufte-handout'] = r"""\documentclass[nobib]{tufte-handout}
\usepackage{graphicx}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage[numbers]{natbib}

\title{Title of the Handout}
\author{Author Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}

\section{Introduction}
Handouts keep a wide margin for notes.\sidenote{A side note in the margin.}

\begin{marginfigure}
  \includegraphics[width=\linewidth]{figures/placeholder}
  \caption{A margin figure.}
\end{marginfigure}

\section{Details}
The \LaTeX{} manual is~\cite{lamport1994}.

\begin{table}[h]
  \centering
  \begin{tabular}{lr}
    \toprule
    Item & Value \\
    \midrule
    First & 1 \\
    Second & 2 \\
    \bottomrule
  \end{tabular}
  \caption{A table with booktabs rules.}
\end{table}

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
"""

T['article'] = r"""\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\usepackage{hyperref}

\title{Title of the Article}
\author{First Author\thanks{University, \texttt{first.author@example.org}} \and Second Author}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}
BODY
\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
"""

T['report'] = r"""\documentclass[11pt,a4paper]{report}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\usepackage{hyperref}

\title{Title of the Report}
\author{Author Name\\Organisation}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
ABSTRACT
\end{abstract}

\tableofcontents

\chapter{Introduction}\label{sec:intro}
State the purpose of the report. Background reading: \cite{lamport1994}.

\chapter{Findings}\label{sec:method}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.7\textwidth]{figures/placeholder}
  \caption{A figure.}
  \label{fig:example}
\end{figure}
Figure~\ref{fig:example} shows the main finding (see Chapter~\ref{sec:intro}).

\chapter{Recommendations}
List the recommendations.

\bibliographystyle{plainnat}
\bibliography{references}

\appendix
\chapter{Data}
Supporting data.

\end{document}
"""

T['beamer'] = r"""\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\usepackage{graphicx}
\usepackage{amsmath}

\title{Title of the Talk}
\subtitle{Subtitle}
\author{Speaker Name}
\institute{University}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Introduction}
\begin{frame}{Motivation}
  \begin{itemize}
    \item<1-> First point
    \item<2-> Second point, shown on the next click
    \item<3-> Third point
  \end{itemize}
\end{frame}

\section{Method}
\begin{frame}{A Figure and an Equation}
  \begin{columns}
    \begin{column}{0.5\textwidth}
      \includegraphics[width=\linewidth]{figures/placeholder}
    \end{column}
    \begin{column}{0.5\textwidth}
      \begin{equation*}
        y = \alpha + \beta x
      \end{equation*}
      \begin{block}{Key idea}
        Explain the idea in one sentence.
      \end{block}
    \end{column}
  \end{columns}
\end{frame}

\section{Conclusion}
\begin{frame}{Summary}
  \begin{enumerate}
    \item What we did
    \item What we found
    \item What comes next
  \end{enumerate}
\end{frame}

\end{document}
"""

T['beamer-metropolis'] = r"""\documentclass[10pt,aspectratio=169]{beamer}
\usetheme[progressbar=frametitle]{metropolis}
\usepackage{graphicx}
\usepackage{booktabs}

\title{Title of the Talk}
\subtitle{Subtitle}
\author{Speaker Name}
\institute{University}
\date{\today}

\begin{document}

\maketitle

\begin{frame}{Outline}
  \setbeamertemplate{section in toc}[sections numbered]
  \tableofcontents[hideallsubsections]
\end{frame}

\section{Introduction}

\begin{frame}{Motivation}
  \begin{itemize}
    \item First point
    \item Second point
    \item Third point
  \end{itemize}
  \alert{Highlight the key message.}
\end{frame}

\section{Results}

\begin{frame}{A Figure}
  \centering
  \includegraphics[width=0.6\linewidth]{figures/placeholder}
\end{frame}

\begin{frame}{A Table}
  \centering
  \begin{tabular}{lrr}
    \toprule
    Method & Accuracy & Time \\
    \midrule
    Baseline & 0.81 & 12.0 \\
    Proposed & 0.87 & 9.5 \\
    \bottomrule
  \end{tabular}
\end{frame}

\begin{frame}[standout]
  Questions?
\end{frame}

\end{document}
"""

T['tikzposter'] = r"""\documentclass[25pt,a0paper,portrait]{tikzposter}
\usepackage{graphicx}
\usepackage{amsmath}
\usetheme{Simple}

\title{Title of the Poster}
\author{First Author, Second Author}
\institute{Department, University}

\begin{document}

\maketitle

\begin{columns}
  \column{0.5}
  \block{Introduction}{
    State the problem and why it matters in a few sentences.
  }
  \block{Method}{
    \begin{tikzfigure}[The approach.]
      \includegraphics[width=0.9\linewidth]{figures/placeholder}
    \end{tikzfigure}
  }

  \column{0.5}
  \block{Results}{
    The model is
    \[ y = \alpha + \beta x . \]
    Summarise the main results here.
  }
  \block{Conclusion}{
    \begin{itemize}
      \item First take-away
      \item Second take-away
    \end{itemize}
  }
\end{columns}

\end{document}
"""

T['beamerposter'] = r"""\documentclass[final]{beamer}
\usepackage[size=a0,scale=1.4,orientation=portrait]{beamerposter}
\usetheme{default}
\usepackage{graphicx}
\usepackage{amsmath}

\setbeamertemplate{navigation symbols}{}
\setbeamercolor{block title}{fg=white,bg=blue!60!black}
\setbeamercolor{block body}{bg=blue!5}

\title{Title of the Poster}
\author{First Author, Second Author}
\institute{Department, University}

\begin{document}
\begin{frame}[t]
  \begin{center}
    {\VeryHuge\bfseries\inserttitle\par}
    \vspace{1em}
    {\Large\insertauthor\par}
    {\large\insertinstitute\par}
  \end{center}
  \vspace{2em}
  \begin{columns}[t]
    \begin{column}{0.45\paperwidth}
      \begin{block}{Introduction}
        State the problem and why it matters.
      \end{block}
      \vspace{1em}
      \begin{block}{Method}
        \centering
        \includegraphics[width=0.9\linewidth]{figures/placeholder}
      \end{block}
    \end{column}
    \begin{column}{0.45\paperwidth}
      \begin{block}{Results}
        The model is $y = \alpha + \beta x$. Summarise the results here.
      \end{block}
      \vspace{1em}
      \begin{block}{Conclusion}
        \begin{itemize}
          \item First take-away
          \item Second take-away
        \end{itemize}
      \end{block}
    \end{column}
  \end{columns}
\end{frame}
\end{document}
"""

T['moderncv'] = r"""\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{classic}
\moderncvcolor{blue}
\usepackage[scale=0.77]{geometry}

\name{First}{Last}
\title{Curriculum Vitae}
\address{Street and number}{Postcode City}{Country}
\phone[mobile]{+1~(234)~567~890}
\email{first.last@example.org}
\homepage{www.example.org}

\begin{document}
\makecvtitle

\section{Education}
\cventry{2020--2024}{Doctor of Philosophy}{University}{City}{}{Thesis title and a one-line summary.}
\cventry{2018--2020}{Master of Science}{University}{City}{}{}

\section{Experience}
\cventry{2024--now}{Position}{Employer}{City}{}{%
\begin{itemize}%
\item Main responsibility
\item An achievement with a number
\end{itemize}}

\section{Skills}
\cvitem{Programming}{Python, C++, \LaTeX}
\cvitem{Languages}{English (fluent), another language (good)}

\section{Publications}
\cvitem{2025}{First Author and Co-author. \emph{Title of the paper.} Journal, 2025.}

\end{document}
"""

T['koma-letter'] = r"""\documentclass[fromalign=right,fromphone,fromemail,parskip=half,foldmarks=true]{scrlttr2}
\usepackage[T1]{fontenc}
\usepackage{lmodern}

\setkomavar{fromname}{Your Name}
\setkomavar{fromaddress}{Street and number\\Postcode City}
\setkomavar{fromphone}{+1 234 567 890}
\setkomavar{fromemail}{your.name@example.org}
\setkomavar{subject}{Subject of the letter}
\setkomavar{date}{\today}

\begin{document}
\begin{letter}{Recipient Name\\Organisation\\Street and number\\Postcode City}

\opening{Dear Recipient,}

Write the body of the letter here. Keep each paragraph to one idea.

The second paragraph.

\closing{Yours sincerely,}

\encl{Curriculum vitae}

\end{letter}
\end{document}
"""

EXTRA = {
    'koma-thesis': THESIS_CHAPTERS,
    'classicthesis': THESIS_CHAPTERS,
    'memoir-book': BOOK_CHAPTERS,
    'koma-book': BOOK_CHAPTERS,
}
NO_BIB = {'beamer', 'beamer-metropolis', 'tikzposter', 'beamerposter', 'moderncv', 'koma-letter'}
NO_FIG = {'moderncv', 'koma-letter', 'ams-article', 'apa7'}
ENGINE = {}  # all pdflatex
BIBER = {'apa7'}


def readme(tid):
    return f"""This folder was created from the "{tid}" starter in the LaTeX Desk template library.
Build it with LaTeX Desk (Ctrl+Alt+B) or with latexmk. The document class comes from your TeX
distribution; check the publisher's author instructions for the current requirements.
"""


def build(tid, out):
    work = os.path.join(tempfile.mkdtemp(prefix='starter-'), tid)
    os.makedirs(work)
    text = T[tid].replace('BODY', BODY).replace('ABSTRACT', ABSTRACT)
    files = {'main.tex': text}
    files.update(EXTRA.get(tid, {}))
    for rel, content in files.items():
        os.makedirs(os.path.dirname(os.path.join(work, rel)) or work, exist_ok=True)
        with open(os.path.join(work, rel), 'w') as f:
            f.write(content)
    if tid not in NO_BIB:
        shutil.copy(os.path.join(COMMON, 'references.bib'), work)
    if tid not in NO_FIG:
        os.makedirs(os.path.join(work, 'figures'), exist_ok=True)
        shutil.copy(os.path.join(COMMON, 'placeholder.pdf'), os.path.join(work, 'figures'))
    sources = sorted(os.path.relpath(os.path.join(d, f), work) for d, _, fs in os.walk(work) for f in fs)

    r = subprocess.run(['latexmk', '-pdf', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'], cwd=work, capture_output=True, text=True, timeout=300)
    log = open(os.path.join(work, 'main.log'), errors='replace').read() if os.path.exists(os.path.join(work, 'main.log')) else ''
    problems = []
    if r.returncode != 0 or not os.path.exists(os.path.join(work, 'main.pdf')):
        problems.append('build failed')
    for pat in [r'There were undefined references', r'Citation .* undefined', r'Reference .* undefined', r'^! ']:
        if re.search(pat, log, re.M):
            problems.append(pat)
    pages = re.search(r'Output written on main.pdf \((\d+) page', log)
    if problems:
        print(f'FAIL {tid}: {problems}')
        tail = '\n'.join([l for l in log.splitlines() if l.startswith('!') or 'undefined' in l][:8])
        print(tail or r.stdout[-1500:])
        return False
    zpath = os.path.join(out, f'{tid}.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in sources:
            z.write(os.path.join(work, rel), rel)
        z.writestr('README.txt', readme(tid))
    print(f'ok   {tid}: {pages.group(1) if pages else "?"} pages, {len(sources)} files, {os.path.getsize(zpath)} bytes')
    return True


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    ids = sys.argv[2:] or list(T)
    results = [build(t, out) for t in ids]
    print(f'{sum(results)}/{len(results)} built')
